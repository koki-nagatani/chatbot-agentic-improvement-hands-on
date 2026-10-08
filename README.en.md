# chatbot-agentic-improvement-hands-on

[日本語版はこちら](README.md)

A hands-on workshop where you continuously improve an existing RAG chatbot by talking to an Improvement Agent built with an agent harness (Flue).

The subject is a chatbot that uses the articles of the [Matsuo Institute tech blog](https://zenn.dev/p/mkj) (on Zenn) as its knowledge source. It answers readers' questions from the articles and points them to the articles it used. The chatbot answers in Japanese, so the example questions below are in Japanese.

## Requirements

- Python 3.12+ and [uv](https://docs.astral.sh/uv/)
- Node.js 22.19+ (24 recommended, pinned in `.node-version`) and [pnpm](https://pnpm.io/)
- An OpenAI API key (OpenAI is the only external LLM API used in this workshop)

All commands are run as `pnpm <script>`.

## Setup

### 1. Install dependencies

```bash
pnpm install   # installs Node dependencies and Python dependencies (uv sync)
```

### 2. Environment variables

```bash
cp .env.example .env
# open .env and set OPENAI_API_KEY
```

### 3. Fetch the knowledge

The chatbot's knowledge is the articles of the Matsuo Institute tech blog. The fetched files are not included in the repository, so run this once during setup.

```bash
pnpm knowledge
```

`scripts/fetch_knowledge.py` fetches every article of the publication (`mkj`, 168 articles when this workshop was created) through Zenn's API, converts them to Markdown, and saves them to `apps/chatbot/knowledge/<article slug>.md`. Requests are spaced one second apart, so this takes 3–4 minutes. Each file starts with front matter recording the article's metadata.

```markdown
---
title: uv × DockerでのPython開発環境構築方法
source: https://zenn.dev/mkj/articles/3aaa36d6f35c08
author: からあげ
published: 2025-10-21
topics: Docker, Python, uv
fetched: 2026-10-08
---

# uv × DockerでのPython開発環境構築方法
...
```

The initial chatbot indexes only `title` and `source` from this front matter, and passes only the chunk text to the LLM when generating an answer. Making use of the author and publication date is one of the things to improve.

> **Note**
> The knowledge reflects the blog at the time you fetch it. If articles are added or updated, the chatbot's answers and eval scores may change too. For a workshop, we recommend that everyone fetch the knowledge on the same day.

### 4. Build the index

Split the knowledge into chunks, create embeddings, and build a FAISS index in `apps/chatbot/index/`. Run this again whenever you re-fetch the knowledge or change the chunking settings.

```bash
pnpm ingest
```

### 5. Measure the baseline score

As the last setup step, run the evals once against the initial bot. This becomes the Before baseline.

```bash
pnpm eval:baseline
```

The initial bot is deliberately immature, so not every case passes. For reference, it scored about 9 / 21 (43%) on average over three runs when this workshop was created. Because of noise in the LLM judge and in the bot's answers, the score varies by a few cases from run to run.

## Run

```bash
pnpm dev
```

Open http://localhost:5173 in your browser. `pnpm dev` starts the following three processes. Press Ctrl+C to stop them.

| Process | Port | Role |
| --- | --- | --- |
| `apps/chatbot/server.py` (FastAPI) | 8000 | Chatbot API. Generates answers and saves / loads traces |
| `apps/improver` (Flue) | 8787 | Improvement Agent and eval result API |
| `apps/ui` (Vite + React) | 5173 | The UI. Proxies requests to the two APIs above |

The chatbot API restarts automatically when the Improvement Agent changes its Python code.

### Chat (`/chat/<session_id>`)

Talk to the inquiry chatbot. Open "Trace" on any answer to see the search query and the retrieved documents.

Conversations are saved as traces in `workspace/traces/chat/<session_id>/`, so reopening the URL always restores the same conversation.

If an answer looks wrong, click "この会話をImproverに共有" (share this conversation with the Improver). The Improver opens with the conversation URL already filled in.

### Improver (`/improve/<session_id>`)

Talk to the Improvement Agent. Besides the agent's replies, the UI shows its tool calls as they run (asking the chatbot, editing files, running evals, and so on). When the agent runs the evals, a Before / After result card appears in the conversation.

The panel on the right lists past eval results. A result's detail view shows pass / fail per case, the chatbot's answer, and the judge's reasons, and you can compare it with another result.

When you give the agent a chat URL, it loads that conversation's traces with the `load_chat_session` tool and investigates how the problematic answer was produced before changing anything.

### Cost

The UI shows the estimated OpenAI API cost (USD).

| Where | What |
| --- | --- |
| Chat | Cost per answer (inside "Trace") and the conversation total |
| Eval results | Total cost of one eval run, split into chatbot and LLM judge |
| Improver | Cost per response and the session total, split into the agent itself (gpt-5.6-terra), questions to the chatbot, and evals |

Costs are estimates: token counts multiplied by the prices in `pricing.yaml`. Chatbot and eval calls are recorded automatically when they go through `settings.openai_client()` (`apps/chatbot/usage.py`). The Improver's own cost is the value calculated by Flue.

As a rough guide, one eval run (21 cases) costs about $0.20, most of it for the LLM judge (gpt-5.6-terra).

## Run the chatbot from the CLI

```bash
# interactive mode (also shows retrieved documents)
pnpm chat

# ask a single question ("I want to get started with MCP. Any recommended articles?")
uv run python apps/chatbot/run.py "MCPを入門したいのですが、おすすめの記事はありますか？"
```

Each answer saves a JSON trace to `workspace/traces/chat/<session_id>/`.

```json
{
  "question": "...",
  "search_query": "...",
  "retrieved_documents": [{"id": "faq#3", "title": "...", "score": 0.61, "text": "..."}],
  "answer": "...",
  "metadata": {"latency_sec": 2.1, "config": {"...": "..."}}
}
```

## Chatbot architecture

```text
START → retrieve → generate → END
```

| File | Role |
| --- | --- |
| `apps/chatbot/graph.py` | LangGraph (two nodes: retrieve / generate) |
| `apps/chatbot/retriever.py` | Semantic search with FAISS |
| `apps/chatbot/ingest.py` | Chunking, embeddings, index building |
| `apps/chatbot/run.py` | CLI and trace output |
| `apps/chatbot/server.py` | Chatbot API (FastAPI) |
| `apps/chatbot/config.yaml` | Model, chunking, and top_k settings |
| `apps/chatbot/prompts/` | System prompt and answer prompt |

The initial chatbot is intentionally simple, like a typical first RAG implementation. It searches with the latest question as-is and retrieves `top_k=3` chunks. It has no grounding check and no conversation-aware retrieval. Improving these through conversation with the Improvement Agent is what this workshop is about.

## Evals

```bash
pnpm eval            # run all cases and compare with the previous result
pnpm eval:compare    # compare the two latest results

# run only some cases
uv run python evals/run_eval.py --case hard-unknown-topic
uv run python evals/run_eval.py --category hard --repeat 3
```

| File | Role |
| --- | --- |
| `evals/cases.yaml` | Eval cases (21 cases: easy / normal / hard) |
| `evals/graders.py` | Deterministic checks (required keywords, forbidden patterns, retrieved documents, length) and the LLM judge (`gpt-5.6-terra`, structured output) |
| `evals/run_eval.py` | Runs the evals. Results go to `evals/results/`, traces to `workspace/traces/eval/` |
| `evals/compare.py` | Before / After comparison |

The LLM judge checks correctness and groundedness on every case. Depending on the case, it also checks completeness, conciseness, unknown_handling, citation (whether the answer names the source articles correctly), and conversation_context. The judge sees each retrieved chunk's text plus whichever of title, author, publication date, and URL the chunk carries. A case passes only when it passes both the deterministic checks and the LLM judge.

The LLM judge and the bot's answers are somewhat noisy: the score of the same bot can move by a few cases. Re-run a case you're unsure about with `--repeat 3`.

## Improvement Agent (CLI)

An agent built with Flue that improves the chatbot. Describe an improvement in natural language, and it autonomously reproduces the problem, inspects traces, identifies the root cause, adds an eval case, makes the change, runs the full evals, and compares Before / After. You can use it from the Improver screen or from the CLI.

[docs/flue.en.md](docs/flue.en.md) explains what this repository builds with Flue and how.

```bash
# "The answer to 'Who wrote the article about building a Python dev environment with uv and Docker?' is wrong. Please improve it."
pnpm improve --id demo-1 -m "「uvとDockerでPythonの開発環境を作る記事を書いたのは誰？」への回答がおかしいです。改善してください。"

# Follow-up requests with the same --id continue the same session
# ("The answers are still long. Make them more concise.")
pnpm improve --id demo-1 -m "回答がまだ長いので、もっと端的にしてください。"
```

`--id` is the Flue agent ID, used as the improvement session ID. The conversation history is stored in `apps/improver/.data/flue.db` and shared between the CLI and the UI, so you can continue a CLI session in the UI by opening `/improve/<id>`.

> **Warning**
> Always run the Flue CLI with `pnpm improve`. If `npx flue` can't find the local CLI, it downloads and runs an unrelated npm package with the same name.

| File | Role |
| --- | --- |
| `apps/improver/src/agents/improver.ts` | The agent (model: `openai/gpt-5.6-terra`) |
| `apps/improver/src/workspace.ts` | Workspace with restricted file access |
| `apps/improver/src/tools.ts` | Tools to run the chatbot and evals, compare results, rebuild the index, and more |
| `apps/improver/skills/rag-debugging/` | Skill for isolating the failing layer (retrieval, grounding, conversation context, ...) |
| `apps/improver/skills/eval-driven-improvement/` | Skill that enforces regression eval → change → full eval → comparison |

### What the agent can and cannot do

| | Scope |
| --- | --- |
| Read | `apps/chatbot/`, `evals/`, `workspace/traces/` |
| Write | `apps/chatbot/`, `evals/cases.yaml` |
| Commands | Only the provided tools (no shell access) |
| Never | `.env`, `.git/`, grading logic (`evals/graders.py`, `evals/run_eval.py`) |

The grading logic is off-limits so the agent can't pass cases by making the evals easier instead of making the bot better. For the same reason, the skill forbids relaxing existing eval cases.

## Development

```bash
pnpm lint     # ruff (lint / format check) and TypeScript type checks
pnpm format   # ruff autofix and formatting
```
