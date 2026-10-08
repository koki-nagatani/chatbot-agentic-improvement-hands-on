# Flue の使い方

[English version is here](flue.en.md)

このリポジトリでFlueを使っているのは、Improvement Agent（`apps/improver`）と、UIのImprover画面（`apps/ui`）です。チャットボット本体（`apps/chatbot`）、Eval（`evals`）、UIのChat画面はFlueに依存しません。

```text
apps/ui（Improver画面）
   │  @flue/react: useFlueAgent
   ▼
apps/improver（Flueサーバー :8787）
   ├─ src/app.ts            createAgentRouter でAgentをHTTPに公開
   ├─ src/db.ts             会話の保存先（SQLite）
   └─ src/agents/improver.ts
        ├─ useModel          openai/gpt-5.6-terra
        ├─ useSandbox        src/workspace.ts（制限付きのファイル操作）
        ├─ useSkill          skills/rag-debugging, skills/eval-driven-improvement
        ├─ useTool           src/tools.ts（チャットボット実行、Eval実行など）
        └─ useResponseFinish 応答ごとのコストを記録
```

## Agent本体：`src/agents/improver.ts`

Flueでは、Agentは「システムプロンプトを返す関数」です。ファイル先頭の `'use agent'` でAgentとして登録され、関数の中でフック（`use〜`）を呼んで機能を足します。

| フック | 使い方 |
| --- | --- |
| `useModel('openai/gpt-5.6-terra', { thinkingLevel: 'medium' })` | Agentが使うモデル。OpenAIのキーは `OPENAI_API_KEY` から読まれる |
| `useSandbox(workspace())` | ファイルを読み書きする作業場所。中身は下の「ワークスペース」 |
| `useSkill(...)` | 2つのSkill（`SKILL.md`）を読み込む |
| `useTool(...)` | `src/tools.ts` のツールを登録する |
| `useResponseFinish(...)` | 応答が終わったときに、その応答のトークン数とコストをメッセージのメタデータに書き込む。UIはこれを集計してセッションのコストを表示する |

関数が返す文字列が、Agentのシステムプロンプトです。改善ループの進め方、依頼の範囲を守ること、編集できる範囲などを書いています。

`Improver.agentName = 'improver'` は、会話を保存するときのAgentの名前です。関数名を変えても既存の会話を引き継げるように固定しています。

## ワークスペース：`src/workspace.ts`

`useSandbox` に渡すサンドボックスです。Flueの `local()` を使い、リポジトリのルートを作業場所にしています。

`local()` はホストのファイルとシェルにそのままアクセスします。標準では `read`、`write`、`edit`、`bash`、`grep`、`glob` の6つのツールが付きますが、このままではAgentが `.env` を読んだり、任意のコマンドを実行したりできてしまいます。そこで、サンドボックスの `tools` を差し替えています。

- `createReadTool`、`createWriteTool`、`createEditTool` に、パスを検査するラッパーを付けたサンドボックスを渡す
- `bash`、`grep`、`glob` は渡さない（コマンドは下の「ツール」からだけ実行できる）

| 操作 | 許可する範囲 |
| --- | --- |
| 読み取り | `apps/chatbot/`、`evals/`、`workspace/traces/` |
| 書き込み | `apps/chatbot/`、`evals/cases.yaml` |
| 常に拒否 | `.env*`、`.git/`、`apps/chatbot/index/` |

`/.flue/packaged-skills/` は、FlueがSkillの付属ファイルを読ませるための仮想パスなので、読み取りを許可しています。

## ツール：`src/tools.ts`

`defineTool` で定義し、入力の型は [Valibot](https://valibot.dev) で書きます。Agentが決められるのは引数だけで、実行するコマンドは固定です（`uv run python ...` や `git diff` を `execFile` で呼ぶ）。

| ツール | 中身 |
| --- | --- |
| `ask_chatbot` | `apps/chatbot/run.py --json` でチャットボットに質問し、Traceを返す |
| `load_chat_session` | Chat画面のURLかセッションIDから、その会話のTraceを読み込む |
| `run_eval` | `evals/run_eval.py` を実行し、スコア、コスト、比較結果、レポートを返す |
| `compare_evals` | 2つのEval結果を比較する |
| `list_eval_results` | 保存済みのEval結果の一覧 |
| `rebuild_index` | `apps/chatbot/ingest.py` でインデックスを作り直す |
| `show_diff` | `apps/chatbot` と `evals/cases.yaml` の `git diff` |
| `list_files`、`search_files` | 読み取りを許可した範囲だけで、ファイル一覧と正規表現検索 |

ツールの戻り値は `{ output: ... }` の形で返します。`run_eval` の `output` はJSONなので、UIはこれを読んで会話の中にEval結果カードを表示します。

ツールの中で `log.info()` を呼ぶと、そのメッセージは画面にだけ流れ、Agentには見えません。

## Skill：`skills/*/SKILL.md`

[Agent Skills](https://agentskills.io) の形式で書いたMarkdownです。`import ... from '../../skills/xxx/SKILL.md'` で読み込み、`useSkill` に渡します。

Agentに常に見えるのは、frontmatterの `name` と `description` だけです。本文は、Agentが必要だと判断したときに読み込まれます。

| Skill | 内容 |
| --- | --- |
| `rag-debugging` | 失敗の原因の層（検索、根拠付け、会話文脈、Knowledge、グラフ構造）を切り分ける手順 |
| `eval-driven-improvement` | 回帰Eval → 修正 → 全Eval → 比較の手順と、守るルール（既存ケースを緩めない、依頼の範囲を守るなど） |

## HTTPサーバー：`src/app.ts`

Flueのサーバーの実体は、[Hono](https://hono.dev) のアプリです。`createAgentRouter(Improver)` を `/api/agents/improver` に載せると、次のルートが自動でできます。

| ルート | 役割 |
| --- | --- |
| `POST /api/agents/improver/:id` | メッセージを送る。すぐに `202` が返り、処理は裏で進む |
| `GET /api/agents/improver/:id` | 会話のイベントと履歴を受け取る |
| `POST /api/agents/improver/:id/abort` | 実行中の処理を中断する |

`:id` が改善セッションのIDです。同じIDに送ると、同じ会話の続きになります。

同じアプリに、Eval結果を返すAPI（`/api/evals`）も載せています。中身は `src/evals.ts` で、Flueの機能は使っていません。

## 会話の保存先：`src/db.ts`

`sqlite('./.data/flue.db')` を返すだけのファイルです。Flueはこのファイルを自動で見つけ、会話をSQLiteに保存します。開発サーバー（`pnpm dev`）とCLI（`pnpm improve`）が同じDBを使うので、CLIで始めたセッションを画面で続けることもできます。

## 設定ファイル

| ファイル | 内容 |
| --- | --- |
| `flue.config.ts` | `target: 'node'`。ローカルのNode.jsで動かす |
| `vite.config.ts` | `flue({ providers: ['openai'] })` でOpenAIだけを読み込む。`.env` はリポジトリのルートから読む（`envDir: '../..'`）。ポートは8787 |
| `src/env.d.ts` | `SKILL.md` をimportするための型定義を読み込む |
| `package.json` | `@flue/runtime`、`@flue/cli`、`@flue/vite`、`@earendil-works/pi-ai`、`hono`、`valibot` |

`@earendil-works/pi-ai` はFlueが内部で使うLLMクライアントです。`providers` を指定すると生成されるコードがこのパッケージを直接importするので、直接の依存関係として入れています。

## UI側：`apps/ui/src/ImproverPage.tsx`

`@flue/react` の `useFlueAgent({ url: '/api/agents/improver/<id>' })` で会話につなぎます。このフックが、履歴の復元、ストリーミング表示、送信をまとめて扱います。

メッセージは `parts` の配列で、次の種類を描き分けています。

| part | 表示 |
| --- | --- |
| `text` | Agentの返答 |
| `reasoning` | 思考（中身があるときだけ折りたたみで表示） |
| `dynamic-tool` | ツールの実行状況。`input-available`（実行中）、`output-available`（完了）、`output-error`（エラー）。`run_eval` の出力はEval結果カードとして表示 |

中断ボタンは、`useFlueAgent` に中断のメソッドがないので、`POST /api/agents/improver/:id/abort` を直接呼んでいます。

## CLIで動かす

`pnpm improve` は、`apps/improver` で `flue run src/agents/improver.ts --env ../../.env` を実行します。サーバーを立てずにAgentを1回動かせます。

```bash
pnpm improve --id demo-1 -m "「uvとDockerでPythonの開発環境を作る記事を書いたのは誰？」への回答がおかしいです。改善してください。"
```

`npx flue` は使わないでください。ローカルのCLIが見つからないと、npmにある同名の無関係なパッケージ（`flue`）をダウンロードして実行してしまいます。

## 参考

- [Flue ドキュメント](https://flueframework.com/docs/)
- [withastro/flue](https://github.com/withastro/flue)
