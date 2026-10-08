"""HTTP API for the chatbot (used by apps/ui).

    uv run uvicorn server:app --app-dir apps/chatbot --port 8000 --reload

A chat session is identified by session_id; its turns are the traces stored in
workspace/traces/chat/<session_id>/, so a session URL can always be restored.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from run import CHAT_TRACES_DIR, ask, history_from, load_session, new_session_id

app = FastAPI(title="Matsuo Institute tech blog chatbot")


class ChatRequest(BaseModel):
    question: str
    session_id: str | None = None


@app.post("/api/chat")
def chat(req: ChatRequest) -> dict[str, Any]:
    if req.session_id and not req.session_id.isalnum():
        raise HTTPException(400, "invalid session_id")
    session_id = req.session_id or new_session_id()
    history = history_from(load_session(session_id))
    return ask(req.question, history, session_id)


@app.get("/api/chat/sessions/{session_id}")
def get_session(session_id: str) -> dict[str, Any]:
    turns = load_session(session_id)
    if not turns:
        raise HTTPException(404, "session not found")
    return {"session_id": session_id, "turns": turns}


@app.get("/api/chat/sessions")
def list_sessions(limit: int = 30) -> list[dict[str, Any]]:
    if not CHAT_TRACES_DIR.is_dir():
        return []
    sessions = []
    for d in CHAT_TRACES_DIR.iterdir():
        turns = load_session(d.name) if d.is_dir() else []
        if turns:
            sessions.append(
                {
                    "session_id": d.name,
                    "turns": len(turns),
                    "updated": turns[-1]["timestamp"],
                    "title": turns[0]["question"],
                }
            )
    sessions.sort(key=lambda s: s["updated"], reverse=True)
    return sessions[:limit]
