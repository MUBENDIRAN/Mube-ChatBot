import sqlite3
import json
from datetime import datetime
from pathlib import Path

DATABASE_FILE = "chat.db"


def init_db():
    """Initialize the database and create tables if they don't exist."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    # Create chats table with user_id and title column
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS chats (
            chat_id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            title TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """
    )

    # Create messages table
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
        )
    """
    )

    conn.commit()
    conn.close()


def save_message(chat_id: str, role: str, content: str) -> None:
    """Save a message to the database."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    cursor.execute(
        """
        INSERT INTO messages (chat_id, role, content)
        VALUES (?, ?, ?)
    """,
        (chat_id, role, content),
    )

    conn.commit()
    conn.close()


def get_chat_history(chat_id: str) -> list:
    """Retrieve chat history for a given chat_id, ordered by timestamp."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT role, content FROM messages
        WHERE chat_id = ?
        ORDER BY timestamp ASC
    """,
        (chat_id,),
    )

    rows = cursor.fetchall()
    conn.close()

    return [{"role": row["role"], "content": row["content"]} for row in rows]


def create_chat(chat_id: str) -> None:
    """Create a new chat session."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    cursor.execute(
        """
        INSERT INTO chats (chat_id)
        VALUES (?)
    """,
        (chat_id,),
    )

    conn.commit()
    conn.close()


def chat_exists(chat_id: str) -> bool:
    """Check if a chat already exists in the database."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT chat_id FROM chats WHERE chat_id = ?
    """,
        (chat_id,),
    )

    result = cursor.fetchone()
    conn.close()
    
    return result is not None


def create_chat_with_title(chat_id: str, user_id: str, title: str) -> None:
    """Create a new chat with an initial title from first user message.
    
    Args:
        chat_id: Unique chat identifier
        user_id: User who owns this chat
        title: Chat title (from first message)
    """
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    # Truncate title if too long
    truncated_title = title[:50] + "..." if len(title) > 50 else title

    cursor.execute(
        """
        INSERT INTO chats (chat_id, user_id, title)
        VALUES (?, ?, ?)
    """,
        (chat_id, user_id, truncated_title),
    )

    conn.commit()
    conn.close()


def delete_chat(chat_id: str) -> None:
    """Delete a chat and all associated messages."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    # Delete messages for this chat
    cursor.execute(
        """
        DELETE FROM messages WHERE chat_id = ?
    """,
        (chat_id,),
    )

    # Delete the chat itself
    cursor.execute(
        """
        DELETE FROM chats WHERE chat_id = ?
    """,
        (chat_id,),
    )

    conn.commit()
    conn.close()


def rename_chat(chat_id: str, new_title: str) -> bool:
    """Rename a chat. Returns True if successful, False if chat not found."""
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()

    # Truncate title if too long
    truncated_title = new_title[:50] + "..." if len(new_title) > 50 else new_title

    cursor.execute(
        """
        UPDATE chats SET title = ? WHERE chat_id = ?
    """,
        (truncated_title, chat_id),
    )

    success = cursor.rowcount > 0
    conn.commit()
    conn.close()

    return success


def get_chat_info(chat_id: str) -> dict:
    """Get chat metadata (chat_id, title, created_at)."""
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT chat_id, user_id, title, created_at FROM chats WHERE chat_id = ?
    """,
        (chat_id,),
    )

    row = cursor.fetchone()
    conn.close()

    if row:
        return {
            "chat_id": row["chat_id"],
            "user_id": row["user_id"],
            "title": row["title"],
            "created_at": row["created_at"],
        }
    return None


def get_user_chats(user_id: str) -> list:
    """Get all chats for a specific user that have messages.
    
    Args:
        user_id: User identifier
        
    Returns:
        List of chats with chat_id and title, ordered by creation date
    """
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT c.chat_id, c.title, c.created_at
        FROM chats c
        WHERE c.user_id = ?
        AND EXISTS (
            SELECT 1 FROM messages m WHERE m.chat_id = c.chat_id
        )
        ORDER BY c.created_at DESC
    """,
        (user_id,),
    )

    rows = cursor.fetchall()
    conn.close()

    return [
        {
            "chat_id": row["chat_id"],
            "title": row["title"] or "New Chat",
        }
        for row in rows
    ]


def get_recent_history(chat_id: str, limit: int = 6) -> list:
    """Retrieve recent chat history for sliding window context.
    
    Args:
        chat_id: The chat session identifier
        limit: Number of recent messages to retrieve (default 6)
        
    Returns:
        List of messages ordered oldest to newest
    """
    conn = sqlite3.connect(DATABASE_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT role, content FROM messages
        WHERE chat_id = ?
        ORDER BY id DESC
        LIMIT ?
    """,
        (chat_id, limit),
    )

    rows = cursor.fetchall()
    conn.close()

    messages = [{"role": row["role"], "content": row["content"]} for row in rows]
    return list(reversed(messages))


def build_prompt(chat_id: str, user_message: str) -> list:
    """Build the complete prompt for the LLM.
    
    Constructs a messages list with:
    1. System prompt
    2. Recent chat history (sliding window)
    3. Current user message
    
    Args:
        chat_id: The chat session identifier
        user_message: The current user's message
        
    Returns:
        List of message dicts ready for the LLM API
    """
    system_prompt = {
        "role": "system",
        "content": "You are Mube's personal AI assistant. Be funny, sarcastic, nerdy, and practical. Keep answers simple and accurate.",
    }
    
    recent_history = get_recent_history(chat_id, limit=6)
    
    current_message = {"role": "user", "content": user_message}
    
    return [system_prompt] + recent_history + [current_message]
