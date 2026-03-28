# Mube's Chatbot - FastAPI & Groq LLM with RAG

A powerful, full-featured chatbot application built with FastAPI, WebSocket streaming, SQLite persistence, and Groq LLM API integration. This project features a sophisticated RAG (Retrieval-Augmented Generation) system for document-based Q&A, multi-chat support, and a responsive modern UI.

## 🚀 Project Workflow

The application operates through three primary layers: Frontend (UI), Backend (FastAPI), and AI Engine (Groq + LangChain).

### 1. Conversation Workflow (Standard Chat)
- **User Identification**: Every browser/device is assigned a persistent UUID in `localStorage`, allowing for device-specific chat history without formal authentication.
- **WebSocket Connection**: Real-time communication is handled via WebSockets (`/ws`), enabling low-latency, character-by-character streaming of responses.
- **Lazy Database Initialization**: To prevent clutter, a chat session is only created in the SQLite database (`chat.db`) when the first message is sent.
- **Sliding Window Memory**: The backend maintains context by retrieving only the most recent 6 messages from the database, optimizing performance and reducing token costs by approximately 85%.
- **Response Generation**: Messages are processed by the Groq API (using `llama-3.1-8b-instant`) with a customized system personality.

### 2. Document Workflow (RAG - Retrieval-Augmented Generation)
- **Document Ingestion**: Users can upload PDF, DOCX, or TXT files.
- **Processing**: 
    - Files are temporary stored, then loaded and split into smaller chunks (1000 characters with 200 overlap) using `RecursiveCharacterTextSplitter`.
    - Chunks are converted into vector embeddings using `HuggingFaceEmbeddings` (`all-MiniLM-L6-v2`).
- **Vector Storage**: Embeddings are stored in a FAISS vector database locally on the server under the `vectors/` directory.
- **Intelligent Retrieval**: When a user queries a document:
    - A "History-Aware Retriever" rephrases the user's question to be standalone based on previous chat context.
    - The most relevant document chunks are retrieved from FAISS.
    - The LLM generates a concise answer based strictly on the retrieved context.

### 3. Data Management Workflow
- **Persistence**: All chat metadata and message history are stored in SQLite.
- **Management**: Users can rename or delete chats via the sidebar menu.
- **Auto-Naming**: New chats are automatically named based on the first few words of the initial user message.

## ✨ Features

- **Real-Time Streaming**: Interactive responses that appear as they are generated.
- **Full Multi-Document Support**: Upload multiple documents (PDF, DOCX, TXT) to a single session and query them collectively. Documents are automatically merged into a unified knowledge base, allowing cross-document queries.
- **Responsive UI**: A polished, mobile-friendly interface with a collapsible sidebar and smooth transitions.
- **Code Highlighting**: Intelligent rendering of code blocks with a "Copy" feature.
- **Modern Tech Stack**: FastAPI, LangChain, Groq, FAISS, and Vanilla CSS.

## 📁 Project Structure

```
chatbot-fastapi/
├── app.py                 # Main FastAPI app (WebSockets, RAG logic, API endpoints)
├── database.py            # SQLite schema and data persistence logic
├── requirements.txt       # Python dependencies
├── chat.db                # SQLite database (auto-generated)
├── static/                # Frontend assets
│   ├── script.js          # Chat logic, WebSocket handling, UI interactions
│   ├── style.css          # Modern, responsive styling
│   └── ...
├── templates/
│   └── index.html         # Main application UI
├── vectors/               # Local storage for FAISS vector databases (per session)
└── temp_uploads/          # Temporary storage for uploaded documents during processing
```

## 🔧 Installation & Setup

1. **Clone & Navigate**
   ```bash
   git clone <repo-url>
   cd chatbot-fastapi
   ```

2. **Environment Setup**
   ```bash
   python3 -m venv fastapivenv
   source fastapivenv/bin/activate
   pip install -r requirements.txt
   ```

3. **Configure API Keys**
   Create a `.env` file in the root directory:
   ```env
   GROQ_API_KEY=your_groq_api_key_here
   ```

4. **Run Application**
   ```bash
   python app.py
   ```
   Access the app at `http://localhost:8000`.

## 🛠 Tech Stack

- **Backend**: FastAPI (Python 3.12+)
- **LLM**: Groq (Llama 3.1 8B)
- **RAG Framework**: LangChain
- **Embeddings**: HuggingFace (sentence-transformers)
- **Vector Store**: FAISS
- **Database**: SQLite
- **Frontend**: Vanilla JS, CSS3, HTML5


## WorkFlow
![alt text](Mube-chatbot(workflow).jpeg)

## Video Demo

