# Mube's Chatbot - FastAPI + Groq + RAG

A full-featured AI chatbot built with FastAPI, WebSocket streaming, SQLite persistence, and document-based RAG (Retrieval-Augmented Generation).  
It supports normal conversation, multi-chat history, and Multi document Q&A over PDF/DOCX/TXT files.

## ✨ Features

- Real-time streaming chat responses
- Persistent chat history with multi-chat sidebar
- Upload and query PDF, DOCX, and TXT files
- Multi-document merge into one searchable knowledge base
- FAISS-based vector retrieval with context-aware prompting
- Responsive frontend with code block rendering

## 🧠 How It Works

### 1) Standard Chat Flow
- Browser gets a persistent `user_id` in local storage
- Frontend sends user message to backend through `/ws` (WebSocket)
- Backend creates chat on first message, stores messages in SQLite
- Prompt is built using recent history and sent to Groq model
- Assistant response streams back to UI in real time

### 2) Document (RAG) Flow
- User uploads document to `/load_document/`
- Backend parses file, chunks content, creates embeddings using Hugging Face Inference API model `sentence-transformers/all-MiniLM-L6-v2`
- Embeddings are saved in FAISS under `vectors/<session_id>`
- User asks questions via `/query_document/`
- Retriever pulls relevant chunks and model answers with context
- Q&A is saved to chat history when `user_id` and `chat_id` are provided

## 📁 Project Structure

```bash
chatbot-fastapi/
├── app.py
├── database.py
├── requirements.txt
├── chat.db
├── templates/
│   └── index.html
├── static/
│   ├── script.js
│   ├── style.css
│   └── mube-chat-bot-logo.jpeg
├── vectors/
├── temp_uploads/
├── Mube-chatbot(workflow).jpeg
└── README.md
```

## ⚙️ Installation

```bash
git clone <repo-url>
cd chatbot-fastapi
python3 -m venv fastapivenv
source fastapivenv/bin/activate
pip install -r requirements.txt
```

Create `.env` in project root:

```env
GROQ_API_KEY=your_groq_api_key_here
HUGGINGFACEHUB_API_TOKEN=your_huggingface_token_here
```

Run the app:

```bash
python app.py
```

Open: `http://localhost:8000`

## 🛠 Tech Stack

- FastAPI
- Groq (`llama-3.1-8b-instant`)
- LangChain
- Embeddings: Hugging Face Inference API (`sentence-transformers/all-MiniLM-L6-v2`)
- FAISS
- SQLite
- Vanilla JavaScript + HTML + CSS

## 🚀 Workflow Diagram

![Mube Chatbot Workflow](Mube-chatbot(workflow).jpeg)

## ▶️ YouTube Link

- Demo: `https://www.youtube.com/watch?v=YOUR_VIDEO_ID`

Replace `YOUR_VIDEO_ID` with your published demo video ID.
