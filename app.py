from groq import Groq
from fastapi import FastAPI, WebSocket, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from dotenv import load_dotenv
import json
from uuid import uuid4
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

load_dotenv()
app = FastAPI()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


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
                temperature=0.7,
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


app.mount("/static", StaticFiles(directory="static"), name="static")