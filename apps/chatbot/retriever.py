"""Semantic search over the FAISS index built by ingest.py."""

from __future__ import annotations

import json
from functools import cache
from typing import Any

import faiss
import numpy as np

from settings import INDEX_DIR, load_config, openai_client


@cache
def _load_index() -> tuple[faiss.Index, list[dict[str, Any]]]:
    index_path = INDEX_DIR / "faiss.index"
    if not index_path.exists():
        raise SystemExit("Index not found. Run `make ingest` first.")
    chunks = [json.loads(line) for line in (INDEX_DIR / "chunks.jsonl").open(encoding="utf-8")]
    return faiss.read_index(str(index_path)), chunks


def search(query: str, top_k: int | None = None) -> list[dict[str, Any]]:
    config = load_config()
    top_k = top_k or config["retrieval"]["top_k"]
    index, chunks = _load_index()

    resp = openai_client().embeddings.create(model=config["embedding"]["model"], input=[query])
    vec = np.array([resp.data[0].embedding], dtype="float32")
    faiss.normalize_L2(vec)

    scores, ids = index.search(vec, top_k)
    return [{**chunks[i], "score": float(s)} for s, i in zip(scores[0], ids[0], strict=True) if i != -1]
