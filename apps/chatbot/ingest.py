"""Build the FAISS index from apps/chatbot/knowledge/*.md.

uv run python apps/chatbot/ingest.py
"""

from __future__ import annotations

import json
import re

import faiss
import numpy as np

from settings import INDEX_DIR, KNOWLEDGE_DIR, load_config, openai_client

EMBED_BATCH = 100


def parse_markdown(text: str) -> tuple[dict[str, str], str]:
    meta: dict[str, str] = {}
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if m:
        for line in m.group(1).splitlines():
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
        text = text[m.end() :]
    return meta, text.strip()


def split_text(text: str, size: int, overlap: int) -> list[str]:
    chunks = []
    start = 0
    while start < len(text):
        chunks.append(text[start : start + size])
        start += size - overlap
    return chunks


def embed(texts: list[str], model: str) -> np.ndarray:
    vectors = []
    for i in range(0, len(texts), EMBED_BATCH):
        resp = openai_client().embeddings.create(model=model, input=texts[i : i + EMBED_BATCH])
        vectors.extend(d.embedding for d in resp.data)
    arr = np.array(vectors, dtype="float32")
    faiss.normalize_L2(arr)
    return arr


def main() -> None:
    config = load_config()
    files = sorted(KNOWLEDGE_DIR.glob("*.md"))
    if not files:
        raise SystemExit("No knowledge found. Run `make knowledge` first.")

    size, overlap = config["chunking"]["chunk_size"], config["chunking"]["chunk_overlap"]
    chunks = []
    for path in files:
        meta, body = parse_markdown(path.read_text(encoding="utf-8"))
        for i, text in enumerate(split_text(body, size, overlap)):
            chunks.append(
                {
                    "id": f"{path.stem}#{i}",
                    "doc": path.stem,
                    "title": meta.get("title", path.stem),
                    "source": meta.get("source", ""),
                    "text": text,
                }
            )

    vectors = embed([c["text"] for c in chunks], config["embedding"]["model"])
    index = faiss.IndexFlatIP(vectors.shape[1])
    index.add(vectors)

    INDEX_DIR.mkdir(parents=True, exist_ok=True)
    faiss.write_index(index, str(INDEX_DIR / "faiss.index"))
    with (INDEX_DIR / "chunks.jsonl").open("w", encoding="utf-8") as f:
        for c in chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"Indexed {len(chunks)} chunks from {len(files)} documents -> {INDEX_DIR}")


if __name__ == "__main__":
    main()
