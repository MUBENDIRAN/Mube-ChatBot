from groq import Groq
from fastapi import FastAPI, WebSocket, Body, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import os
from dotenv import load_dotenv
import json
from uuid import uuid4
import hashlib
from database import (
    init_db,
    save_message,
    get_chat_history,
    build_prompt,
    chat_exists,
    create_chat_with_title,
    delete_chat,
    rename_chat,
    get_chat_info,
    get_user_chats,
)

from langchain.chains import create_history_aware_retriever, create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_community.vectorstores import FAISS
from langchain_community.document_loaders import PyPDFLoader, Docx2txtLoader, TextLoader
from langchain_core.embeddings import Embeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
import requests


load_dotenv()
app = FastAPI()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


class HFInferenceEmbeddings(Embeddings):
    """Direct HuggingFace Inference API embeddings — bypasses broken langchain wrapper."""

    def __init__(self, api_key: str, model_name: str = "sentence-transformers/all-MiniLM-L6-v2"):
        if not api_key:
            raise ValueError("HUGGINGFACEHUB_API_TOKEN is missing. Please set it in your .env file.")
        self.api_urls = [
            f"https://router.huggingface.co/hf-inference/models/{model_name}/pipeline/feature-extraction",
            f"https://api-inference.huggingface.co/models/{model_name}",
        ]
        self.headers = {"Authorization": f"Bearer {api_key}"}

    def _query(self, texts: list) -> list:
        payload = {"inputs": texts, "options": {"wait_for_model": True}}
        last_error = None

        for api_url in self.api_urls:
            try:
                response = requests.post(
                    api_url,
                    headers=self.headers,
                    json=payload,
                    timeout=30,
                )
                response.raise_for_status()
                result = response.json()
                if isinstance(result, dict) and "error" in result:
                    raise ValueError(f"HuggingFace API error from {api_url}: {result['error']}")
                return result
            except requests.exceptions.RequestException as exc:
                last_error = exc
                continue

        raise ValueError(
            "Failed to reach Hugging Face inference endpoints. "
            f"Last error: {last_error}"
        )

    def embed_documents(self, texts: list) -> list:
        return self._query(texts)

    def embed_query(self, text: str) -> list:
        result = self._query([text])
        return result[0]


# Lazy load embeddings — only created when first document is uploaded
_embeddings = None

def get_embeddings():
    global _embeddings
    if _embeddings is None:
        _embeddings = HFInferenceEmbeddings(
            api_key=os.getenv("HUGGINGFACEHUB_API_TOKEN"),
        )
    return _embeddings

# LLM for langchain RAG
llm = ChatGroq(model="llama-3.1-8b-instant", temperature=0.2)

# Vectorstore cache and session history
vectorstore_cache = {}
session_store = {}
document_hash_map = {}  # Maps document hashes to session IDs


def get_file_hash(file_content: bytes) -> str:
    """Calculate MD5 hash of file content."""
    return hashlib.md5(file_content).hexdigest()


def get_session_history(session_id: str) -> BaseChatMessageHistory:
    """Get or create chat message history for a session."""
    if session_id not in session_store:
        session_store[session_id] = ChatMessageHistory()
    return session_store[session_id]


@app.on_event("startup")
async def startup_event():
    """Initialize database on app startup."""
    init_db()


@app.get("/")
async def get_home():
    return FileResponse("templates/index.html")


@app.post("/new_chat")
async def new_chat(body: dict = Body(...)):
    """Generate a new chat_id for a user.
    
    The chat will be created when the first message arrives.
    """
    user_id = body.get("user_id")
    
    if not user_id:
        return {"error": "user_id is required"}
    
    chat_id = str(uuid4())
    return {"chat_id": chat_id}


@app.get("/chats/{user_id}")
async def get_chats(user_id: str):
    """Get list of chats for a user that have messages, with titles."""
    chats = get_user_chats(user_id)
    return chats


@app.get("/chat/{chat_id}")
async def get_chat(chat_id: str):
    """Get all messages for a specific chat."""
    from database import get_chat_history
    history = get_chat_history(chat_id)
    return history


@app.delete("/chat/{chat_id}")
async def delete_chat_endpoint(chat_id: str):
    """Delete a chat and all its messages."""
    delete_chat(chat_id)
    return {"status": "deleted"}


@app.put("/chat/{chat_id}/rename")
async def rename_chat_endpoint(chat_id: str, body: dict = Body(...)):
    """Rename a chat."""
    new_title = body.get("title", "").strip()
    
    if not new_title:
        return {"error": "Title cannot be empty"}
    
    success = rename_chat(chat_id, new_title)
    
    if not success:
        return {"error": "Chat not found"}
    
    chat_info = get_chat_info(chat_id)
    return chat_info


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            message_data = json.loads(data)
            chat_id = message_data.get("chat_id")
            user_id = message_data.get("user_id")
            user_content = message_data.get("content")

            if not chat_id or not user_id or not user_content:
                await websocket.send_text(
                    json.dumps(
                        {"type": "error", "content": "Missing chat_id, user_id, or content"}
                    )
                )
                continue

            # Create chat on first message if it doesn't exist
            if not chat_exists(chat_id):
                create_chat_with_title(chat_id, user_id, user_content)

            # Save user message to database
            save_message(chat_id, "user", user_content)

            # Build prompt with sliding window history
            chat_log = build_prompt(chat_id, user_content)

            # Get response from Groq API
            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=chat_log,
                temperature=0.5,
                top_p=0.9,
                max_tokens=1000,
                stream=True,
            )

            # Stream and collect response
            full_response = ""
            for chunk in response:
                if chunk.choices[0].delta.content:
                    full_response += chunk.choices[0].delta.content
                    await websocket.send_text(
                        json.dumps({"type": "stream", "content": chunk.choices[0].delta.content})
                    )

            # Save assistant message to database
            save_message(chat_id, "assistant", full_response)
            await websocket.send_text(json.dumps({"type": "complete"}))

    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "content": str(e)}))


@app.post("/load_document/")
async def load_document_upload(file: UploadFile = File(...), session_id: str = Form(...)):
    """Upload and process a document file (PDF, DOCX, TXT) for RAG. Supports multiple documents by merging."""
    print(f"Received document for processing: {file.filename}")
    os.makedirs("temp_uploads", exist_ok=True)
    os.makedirs("vectors", exist_ok=True)

    # Check file type
    file_ext = file.filename.lower().split('.')[-1]
    allowed_extensions = ['pdf', 'docx', 'txt']
    
    if file_ext not in allowed_extensions:
        return JSONResponse(
            status_code=400, 
            content={"error": f"Only {', '.join(allowed_extensions).upper()} files are allowed."}
        )

    # Read file content
    file_content = await file.read()
    
    # Calculate file hash to check if we've seen this document before
    file_hash = get_file_hash(file_content)
    
    # Save uploaded file temporarily
    file_location = f"temp_uploads/{file.filename}"
    with open(file_location, "wb") as f:
        f.write(file_content)

    try:
        # Load document based on file type
        if file_ext == 'pdf':
            loader = PyPDFLoader(file_location)
        elif file_ext == 'docx':
            loader = Docx2txtLoader(file_location)
        elif file_ext == 'txt':
            loader = TextLoader(file_location, encoding='utf-8')
        
        documents = loader.load()
        
        # Add filename to metadata for tracking
        for doc in documents:
            doc.metadata['source_filename'] = file.filename
        
        # Split into text chunks
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        splits = text_splitter.split_documents(documents)
        
        # Check if session already has documents (merge scenario)
        if session_id in vectorstore_cache:
            # MERGE: Add new document to existing vectorstore
            print(f"Merging {file.filename} with existing documents in session {session_id}")
            existing_vectorstore = vectorstore_cache[session_id]
            
            # Create new vectorstore from new documents
            new_vectorstore = FAISS.from_documents(splits, get_embeddings())
            
            # Merge the two vectorstores
            existing_vectorstore.merge_from(new_vectorstore)
            
            # Save merged vectorstore
            vectorstore_path = f"vectors/{session_id}"
            existing_vectorstore.save_local(vectorstore_path)
            
            vectorstore_cache[session_id] = existing_vectorstore
            
            print(f"Successfully merged {file_ext.upper()} into existing collection")
            return {
                "message": f"Added {file.filename} to existing documents",
                "filename": file.filename,
                "file_type": file_ext.upper(),
                "merged": True
            }
        else:
            # FIRST DOCUMENT: Create new vectorstore
            print(f"Creating new document collection for session {session_id}")
            vectorstore = FAISS.from_documents(splits, get_embeddings())
            vectorstore_path = f"vectors/{session_id}"
            os.makedirs(vectorstore_path, exist_ok=True)
            vectorstore.save_local(vectorstore_path)

            # Cache vectorstore
            vectorstore_cache[session_id] = vectorstore
            
            print(f"Successfully processed {file_ext.upper()}")
            return {
                "message": "Uploaded successfully",
                "filename": file.filename,
                "file_type": file_ext.upper(),
                "merged": False
            }

    except Exception as e:
        print(f"Error processing document: {str(e)}")
        return JSONResponse(status_code=500, content={"error": str(e)})
    finally:
        # Clean up temp file
        if os.path.exists(file_location):
            os.remove(file_location)


@app.post("/query_document/")
async def query_document(body: dict = Body(...)):
    """Query the uploaded document using RAG."""
    session_id = body.get("session_id")
    prompt = body.get("prompt")
    user_id = body.get("user_id")
    chat_id = body.get("chat_id")
    
    if not session_id or not prompt:
        return JSONResponse(status_code=400, content={"error": "session_id and prompt are required."})
    
    vectorstore_path = f"vectors/{session_id}"

    # If vectorstore not cached, attempt to load from disk
    if session_id not in vectorstore_cache:
        if os.path.exists(vectorstore_path):
            try:
                vectorstore = FAISS.load_local(
                    vectorstore_path,
                    get_embeddings(),
                    allow_dangerous_deserialization=True
                )
                vectorstore_cache[session_id] = vectorstore
            except Exception as e:
                return JSONResponse(
                    status_code=500,
                    content={"error": f"Failed to load vectorstore: {str(e)}"}
                )
        else:
            return JSONResponse(
                status_code=400,
                content={"error": "Please load a PDF first for this session."}
            )

    retriever = vectorstore_cache[session_id].as_retriever()

    # Create a prompt to rephrase context-dependent queries
    contextualize_q_prompt = ChatPromptTemplate.from_messages([
        ("system", "Given a chat history and the latest user question which might reference context, formulate a standalone question."),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}"),
    ])
    history_aware_retriever = create_history_aware_retriever(llm, retriever, contextualize_q_prompt)

    # Final answering prompt using context
    qa_prompt = ChatPromptTemplate.from_messages([
        ("system",
         "Use the context below to answer the question **briefly and clearly in short**. Limit your response to key information. If unsure, say you don't know.\n\n{context}"),
        MessagesPlaceholder("chat_history"),
        ("human", "{input}"),
    ])
    document_chain = create_stuff_documents_chain(llm, qa_prompt)
    rag_chain = create_retrieval_chain(history_aware_retriever, document_chain)

    # Combine retrieval with conversation memory
    conversational_rag_chain = RunnableWithMessageHistory(
        rag_chain,
        lambda sid: get_session_history(sid),
        input_messages_key="input",
        history_messages_key="chat_history",
        output_messages_key="answer"
    )

    # Generate response
    try:
        response = conversational_rag_chain.invoke(
            {"input": prompt},
            config={"configurable": {"session_id": session_id}},
        )
        answer = response["answer"]
        
        # Ensure chat exists before saving document-mode messages
        if user_id and chat_id:
            if not chat_exists(chat_id):
                create_chat_with_title(chat_id, user_id, prompt)
            save_message(chat_id, "user", prompt)
            save_message(chat_id, "assistant", answer)
        
        return {"answer": answer}
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


app.mount("/static", StaticFiles(directory="static"), name="static")
