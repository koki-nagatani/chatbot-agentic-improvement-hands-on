"""Shared paths, config loading and OpenAI client for the chatbot."""

from __future__ import annotations

from functools import cache
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv
from openai import DefaultHttpxClient, OpenAI

from usage import on_response

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent.parent
KNOWLEDGE_DIR = APP_DIR / "knowledge"
INDEX_DIR = APP_DIR / "index"
PROMPTS_DIR = APP_DIR / "prompts"
TRACES_DIR = ROOT / "workspace" / "traces"

load_dotenv(ROOT / ".env")


def load_config() -> dict[str, Any]:
    return yaml.safe_load((APP_DIR / "config.yaml").read_text(encoding="utf-8"))


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.md").read_text(encoding="utf-8")


@cache
def openai_client() -> OpenAI:
    """The OpenAI client for all chatbot and eval calls. Usage is metered automatically (see usage.py),
    so always create OpenAI calls through this client."""
    return OpenAI(http_client=DefaultHttpxClient(event_hooks={"response": [on_response]}))
