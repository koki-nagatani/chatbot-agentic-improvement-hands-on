"""Token usage and cost metering for OpenAI calls.

Every request made through settings.openai_client() is recorded automatically by an
httpx response hook, so new graph nodes are metered without extra code:

    with metering() as meter:
        ...  # any OpenAI calls
    meter.summary()  # {"calls": 2, "input_tokens": ..., "cost_usd": ...}
"""

from __future__ import annotations

import contextvars
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from functools import cache
from pathlib import Path
from typing import Any

import httpx
import yaml

PRICING_PATH = Path(__file__).resolve().parent.parent.parent / "pricing.yaml"

_current: contextvars.ContextVar[UsageMeter | None] = contextvars.ContextVar("usage_meter", default=None)


@cache
def _pricing() -> dict[str, dict[str, float]]:
    return yaml.safe_load(PRICING_PATH.read_text(encoding="utf-8"))["models"]


def price_for(model: str) -> dict[str, float] | None:
    """Longest pricing key that the (possibly dated) model id starts with."""
    matches = [k for k in _pricing() if model == k or model.startswith(f"{k}-")]
    return _pricing()[max(matches, key=len)] if matches else None


class UsageMeter:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def record(self, model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> None:
        price = price_for(model)
        cost = None
        if price:
            cost = (
                (input_tokens - cached_tokens) * price["input"]
                + cached_tokens * price["cached_input"]
                + output_tokens * price["output"]
            ) / 1_000_000
        with self._lock:
            self.calls.append(
                {
                    "model": model,
                    "input_tokens": input_tokens,
                    "cached_tokens": cached_tokens,
                    "output_tokens": output_tokens,
                    "cost_usd": cost,
                }
            )

    def summary(self) -> dict[str, Any]:
        with self._lock:
            calls = list(self.calls)
        return {
            "calls": len(calls),
            "input_tokens": sum(c["input_tokens"] for c in calls),
            "output_tokens": sum(c["output_tokens"] for c in calls),
            "cost_usd": round(sum(c["cost_usd"] or 0 for c in calls), 6),
            "unpriced_models": sorted({c["model"] for c in calls if c["cost_usd"] is None}),
        }


@contextmanager
def metering() -> Iterator[UsageMeter]:
    meter = UsageMeter()
    token = _current.set(meter)
    try:
        yield meter
    finally:
        _current.reset(token)


def on_response(response: httpx.Response) -> None:
    """httpx response hook: record the usage of a JSON OpenAI response into the current meter."""
    meter = _current.get()
    if meter is None or response.status_code != 200:
        return
    if "application/json" not in response.headers.get("content-type", ""):
        return
    response.read()
    body = response.json()
    usage = body.get("usage") or {}
    model = body.get("model", "unknown")
    if "prompt_tokens" in usage:  # chat completions / embeddings
        details = usage.get("prompt_tokens_details") or {}
        meter.record(
            model,
            usage["prompt_tokens"],
            usage.get("completion_tokens", 0),
            details.get("cached_tokens", 0),
        )
    elif "input_tokens" in usage:  # responses API
        details = usage.get("input_tokens_details") or {}
        meter.record(
            model, usage["input_tokens"], usage.get("output_tokens", 0), details.get("cached_tokens", 0)
        )
