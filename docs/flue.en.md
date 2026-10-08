# How this repository uses Flue

[日本語版はこちら](flue.md)

Flue is used by the Improvement Agent (`apps/improver`) and the Improver screen of the UI (`apps/ui`). The chatbot itself (`apps/chatbot`), the evals (`evals`), and the Chat screen of the UI do not depend on Flue.

```text
apps/ui (Improver screen)
   │  @flue/react: useFlueAgent
   ▼
apps/improver (Flue server :8787)
   ├─ src/app.ts            exposes the agent over HTTP with createAgentRouter
   ├─ src/db.ts             conversation store (SQLite)
   └─ src/agents/improver.ts
        ├─ useModel          openai/gpt-5.6-terra
        ├─ useSandbox        src/workspace.ts (restricted file access)
        ├─ useSkill          skills/rag-debugging, skills/eval-driven-improvement
        ├─ useTool           src/tools.ts (run the chatbot, run evals, ...)
        └─ useResponseFinish records the cost of each response
```

## The agent: `src/agents/improver.ts`

In Flue, an agent is a function that returns its system prompt. The `'use agent'` directive at the top of the file registers it as an agent, and hooks (`use...`) called inside the function add capabilities.

| Hook | Usage |
| --- | --- |
| `useModel('openai/gpt-5.6-terra', { thinkingLevel: 'medium' })` | The model the agent uses. The OpenAI key is read from `OPENAI_API_KEY` |
| `useSandbox(workspace())` | Where the agent reads and writes files. See "Workspace" below |
| `useSkill(...)` | Loads the two skills (`SKILL.md`) |
| `useTool(...)` | Registers the tools in `src/tools.ts` |
| `useResponseFinish(...)` | When a response finishes, writes its token usage and cost to the message metadata. The UI sums these to show the session cost |

The string the function returns is the agent's system prompt. It describes how to run the improvement loop, to stay within the scope of the request, what the agent may edit, and so on.

`Improver.agentName = 'improver'` is the agent name used when storing conversations. It is pinned so that renaming the function doesn't orphan existing conversations.

## Workspace: `src/workspace.ts`

The sandbox passed to `useSandbox`. It uses Flue's `local()` with the repository root as the working directory.

`local()` gives direct access to the host filesystem and shell. By default it comes with six tools (`read`, `write`, `edit`, `bash`, `grep`, `glob`), which would let the agent read `.env` or run any command. So the sandbox's `tools` are replaced:

- `createReadTool`, `createWriteTool`, and `createEditTool` are given a sandbox wrapped with a path check
- `bash`, `grep`, and `glob` are not provided (commands can only be run through the tools below)

| Operation | Allowed |
| --- | --- |
| Read | `apps/chatbot/`, `evals/`, `workspace/traces/` |
| Write | `apps/chatbot/`, `evals/cases.yaml` |
| Always denied | `.env*`, `.git/`, `apps/chatbot/index/` |

`/.flue/packaged-skills/` is a virtual path Flue uses to serve a skill's supporting files, so reading it is allowed.

## Tools: `src/tools.ts`

Defined with `defineTool`, with input schemas written in [Valibot](https://valibot.dev). The agent only chooses the arguments; the commands themselves are fixed (`uv run python ...` and `git diff`, called with `execFile`).

| Tool | What it does |
| --- | --- |
| `ask_chatbot` | Asks the chatbot a question via `apps/chatbot/run.py --json` and returns the trace |
| `load_chat_session` | Loads the traces of a conversation from a Chat screen URL or session ID |
| `run_eval` | Runs `evals/run_eval.py` and returns the scores, cost, comparison, and report |
| `compare_evals` | Compares two eval results |
| `list_eval_results` | Lists saved eval results |
| `rebuild_index` | Rebuilds the index with `apps/chatbot/ingest.py` |
| `show_diff` | `git diff` of `apps/chatbot` and `evals/cases.yaml` |
| `list_files`, `search_files` | File listing and regex search, limited to readable paths |

Tools return `{ output: ... }`. The `output` of `run_eval` is JSON, which the UI reads to show an eval result card in the conversation.

Messages logged with `log.info()` inside a tool are streamed to the UI only; the agent doesn't see them.

## Skills: `skills/*/SKILL.md`

Markdown files in the [Agent Skills](https://agentskills.io) format. They are loaded with `import ... from '../../skills/xxx/SKILL.md'` and passed to `useSkill`.

The agent always sees only the `name` and `description` from the front matter. The body is loaded when the agent decides it needs the skill.

| Skill | Content |
| --- | --- |
| `rag-debugging` | How to isolate the failing layer (retrieval, grounding, conversation context, knowledge, graph architecture) |
| `eval-driven-improvement` | The regression eval → change → full eval → comparison procedure, and its rules (never relax existing cases, stay within the scope of the request, ...) |

## HTTP server: `src/app.ts`

A Flue server is a [Hono](https://hono.dev) app. Mounting `createAgentRouter(Improver)` at `/api/agents/improver` creates these routes:

| Route | Role |
| --- | --- |
| `POST /api/agents/improver/:id` | Sends a message. Returns `202` immediately; the work continues in the background |
| `GET /api/agents/improver/:id` | Streams the conversation's events and history |
| `POST /api/agents/improver/:id/abort` | Aborts the running work |

`:id` is the improvement session ID. Messages sent to the same ID continue the same conversation.

The same app also serves the eval result API (`/api/evals`), implemented in `src/evals.ts` without any Flue features.

## Conversation store: `src/db.ts`

This file just returns `sqlite('./.data/flue.db')`. Flue finds it automatically and stores conversations in SQLite. The dev server (`pnpm dev`) and the CLI (`pnpm improve`) share the same database, so a session started from the CLI can be continued in the UI.

## Configuration files

| File | Content |
| --- | --- |
| `flue.config.ts` | `target: 'node'`: runs on local Node.js |
| `vite.config.ts` | `flue({ providers: ['openai'] })` loads only the OpenAI provider. Reads `.env` from the repository root (`envDir: '../..'`). Port 8787 |
| `src/env.d.ts` | Loads the type declarations for importing `SKILL.md` |
| `package.json` | `@flue/runtime`, `@flue/cli`, `@flue/vite`, `@earendil-works/pi-ai`, `hono`, `valibot` |

`@earendil-works/pi-ai` is the LLM client Flue uses internally. Setting `providers` generates code that imports this package directly, so it is a direct dependency.

## UI: `apps/ui/src/ImproverPage.tsx`

`useFlueAgent({ url: '/api/agents/improver/<id>' })` from `@flue/react` connects to the conversation. The hook handles restoring history, streaming, and sending messages.

A message is an array of `parts`, rendered by type:

| part | Rendering |
| --- | --- |
| `text` | The agent's reply |
| `reasoning` | Reasoning (collapsed, shown only when non-empty) |
| `dynamic-tool` | Tool call status: `input-available` (running), `output-available` (done), `output-error` (error). The output of `run_eval` is shown as an eval result card |

`useFlueAgent` has no abort method, so the abort button calls `POST /api/agents/improver/:id/abort` directly.

## Running from the CLI

`pnpm improve` runs `flue run src/agents/improver.ts --env ../../.env` in `apps/improver`. It runs the agent once without starting a server.

```bash
# "The answer to 'Who wrote the article about building a Python dev environment with uv and Docker?' is wrong. Please improve it."
pnpm improve --id demo-1 -m "「uvとDockerでPythonの開発環境を作る記事を書いたのは誰？」への回答がおかしいです。改善してください。"
```

Don't use `npx flue`. If it can't find the local CLI, it downloads and runs an unrelated npm package with the same name (`flue`).

## References

- [Flue documentation](https://flueframework.com/docs/)
- [withastro/flue](https://github.com/withastro/flue)
