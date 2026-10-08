"""Run the chatbot and write a JSON trace per turn to workspace/traces/chat/<session_id>/.

uv run python apps/chatbot/run.py "MCPの入門記事はありますか？"   # single question
uv run python apps/chatbot/run.py                              # interactive chat
"""

from __future__ import annotations

import argparse
import json
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from graph import build_graph
from settings import TRACES_DIR, load_config
from usage import metering

CHAT_TRACES_DIR = TRACES_DIR / "chat"


def new_session_id() -> str:
    return uuid.uuid4().hex[:12]


def ask(
    question: str,
    history: list[dict[str, str]] | None = None,
    session_id: str | None = None,
    trace_dir: Path | None = None,
) -> dict[str, Any]:
    """Answer one question. Returns the trace dict (also saved to disk).

    Traces go to workspace/traces/chat/<session_id>/ unless trace_dir is given.
    """
    session_id = session_id or new_session_id()
    started = time.perf_counter()
    with metering() as meter:
        state = build_graph().invoke({"question": question, "history": history or []})
    trace = {
        "id": uuid.uuid4().hex[:12],
        "session_id": session_id,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "question": question,
        "history": history or [],
        "search_query": state.get("search_query"),
        # Every chunk field is kept, so metadata added in ingest.py shows up in traces.
        "retrieved_documents": [dict(doc) for doc in state.get("context", [])],
        "answer": state["answer"],
        "usage": meter.summary(),
        "metadata": {
            "latency_sec": round(time.perf_counter() - started, 2),
            "config": load_config(),
        },
    }
    trace["trace_path"] = str(_write_trace(trace, trace_dir or CHAT_TRACES_DIR / session_id))
    return trace


def _write_trace(trace: dict[str, Any], trace_dir: Path) -> Path:
    trace_dir.mkdir(parents=True, exist_ok=True)
    path = trace_dir / f"{datetime.now():%Y%m%d-%H%M%S}-{trace['id']}.json"
    path.write_text(json.dumps(trace, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def load_session(session_id: str) -> list[dict[str, Any]]:
    """All traces of a chat session, oldest first."""
    session_dir = CHAT_TRACES_DIR / session_id
    if not session_id.isalnum() or not session_dir.is_dir():
        return []
    # File names start with a timestamp, so name order is chronological.
    return [
        {**json.loads(p.read_text(encoding="utf-8")), "trace_path": str(p)}
        for p in sorted(session_dir.glob("*.json"))
    ]


def history_from(traces: list[dict[str, Any]]) -> list[dict[str, str]]:
    history: list[dict[str, str]] = []
    for t in traces:
        history += [{"role": "user", "content": t["question"]}, {"role": "assistant", "content": t["answer"]}]
    return history


def main() -> None:
    parser = argparse.ArgumentParser(description="Matsuo Institute tech blog chatbot")
    parser.add_argument("question", nargs="?", help="Ask a single question and exit")
    parser.add_argument("--show-context", action="store_true", help="Print retrieved documents")
    parser.add_argument(
        "--history-json", help='Prior turns as JSON: [{"role": "user", "content": "..."}, ...]'
    )
    parser.add_argument("--json", action="store_true", help="Print the full trace as JSON")
    args = parser.parse_args()

    def show(trace: dict[str, Any]) -> None:
        if args.json:
            print(json.dumps(trace, ensure_ascii=False, indent=2))
            return
        if args.show_context:
            for doc in trace["retrieved_documents"]:
                print(f"  [{doc['score']:.3f}] {doc['id']}  {doc['title']}")
        cost = trace["usage"]["cost_usd"]
        print(f"A: {trace['answer']}\n   (${cost:.4f} · trace: {trace['trace_path']})\n")

    if args.question:
        history = json.loads(args.history_json) if args.history_json else None
        show(ask(args.question, history))
        return

    session_id = new_session_id()
    history: list[dict[str, str]] = []
    print("松尾研究所テックブログ チャットボット (Ctrl+D で終了)\n")
    while True:
        try:
            question = input("Q: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not question:
            continue
        trace = ask(question, history, session_id)
        show(trace)
        history += [{"role": "user", "content": question}, {"role": "assistant", "content": trace["answer"]}]


if __name__ == "__main__":
    main()
