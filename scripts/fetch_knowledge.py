"""Fetch every article of the Matsuo Institute tech blog on Zenn and save it as Markdown.

Articles are listed and fetched through Zenn's JSON API (the same one the site uses),
so no page scraping is needed. Run once during setup:

    uv run python scripts/fetch_knowledge.py
"""

from __future__ import annotations

import re
import time
from datetime import date
from pathlib import Path

import httpx
from bs4 import BeautifulSoup
from markdownify import markdownify

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "apps" / "chatbot" / "knowledge"

PUBLICATION = "mkj"  # https://zenn.dev/p/mkj
API = "https://zenn.dev/api/articles"
SITE = "https://zenn.dev"
INTERVAL_SEC = 1.0

DROP_TAGS = ["script", "style", "noscript", "svg", "iframe", "img", "embed-block"]


def list_articles(client: httpx.Client) -> list[dict]:
    articles: list[dict] = []
    page: int | None = 1
    while page:
        resp = client.get(API, params={"publication_name": PUBLICATION, "order": "latest", "page": page})
        resp.raise_for_status()
        data = resp.json()
        articles.extend(data["articles"])
        page = data.get("next_page")
        time.sleep(INTERVAL_SEC)
    return articles


def html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(DROP_TAGS):
        tag.decompose()
    # Heading anchors, embedded link cards and the "!" icon of message boxes carry
    # no text worth indexing.
    for tag in soup.select("a.header-anchor-link, .zenn-embedded, .embed-block, .msg-symbol"):
        tag.decompose()

    md = markdownify(str(soup), heading_style="ATX", strip=["a"])
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return md


def front_matter(fields: dict[str, str]) -> str:
    lines = [f"{k}: {v}" for k, v in fields.items()]
    return "---\n" + "\n".join(lines) + "\n---\n\n"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    today = date.today().isoformat()
    with httpx.Client(
        headers={"User-Agent": "Mozilla/5.0 (hands-on knowledge fetch)"}, follow_redirects=True, timeout=30
    ) as client:
        articles = list_articles(client)
        print(f"{len(articles)} articles in publication '{PUBLICATION}'")
        for summary in articles:
            slug = summary["slug"]
            resp = client.get(f"{API}/{slug}")
            resp.raise_for_status()
            article = resp.json()["article"]

            title = article["title"].replace("\n", " ").strip()
            body = html_to_markdown(article["body_html"])
            meta = {
                "title": title,
                "source": SITE + article["path"],
                "author": article["user"]["name"],
                "published": article["published_at"][:10],
                "topics": ", ".join(t["display_name"] for t in article.get("topics", [])),
                "fetched": today,
            }
            text = front_matter(meta) + f"# {title}\n\n" + body + "\n"
            (OUT_DIR / f"{slug}.md").write_text(text, encoding="utf-8")
            print(f"{meta['published']}  {len(body):6d} chars  {slug}")
            time.sleep(INTERVAL_SEC)


if __name__ == "__main__":
    main()
