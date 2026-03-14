from groq import Groq
from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from dotenv import load_dotenv
import json

load_dotenv()
app = FastAPI()

client = Groq(api_key=os.getenv("GROQ_API_KEY"))


@app.get("/")
async def get_home():
    return FileResponse("templates/index.html")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    chat_log = [
        {
            "role": "system",
            "content": "You are Mube's chatbot.Be funny, sarcastic, nerdy, and practical. Keep answers simple and accurate.",
        }
    ]
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            user_message = json.loads(data)

            chat_log.append({"role": "user", "content": user_message["content"]})

            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=chat_log,
                temperature=0.7,
                top_p=0.9,
                max_tokens=1000,
                stream=True,
            )

            full_response = ""
            for chunk in response:
                if chunk.choices[0].delta.content:
                    full_response += chunk.choices[0].delta.content
                    await websocket.send_text(
                        json.dumps({"type": "stream", "content": chunk.choices[0].delta.content})
                    )

            chat_log.append({"role": "assistant", "content": full_response})
            await websocket.send_text(json.dumps({"type": "complete"}))

    except Exception as e:
        await websocket.send_text(json.dumps({"type": "error", "content": str(e)}))


app.mount("/static", StaticFiles(directory="static"), name="static")