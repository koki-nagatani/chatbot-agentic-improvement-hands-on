# chatbot-agentic-improvement-hands-on

[English version is here](README.en.md)

既存のRAGチャットボットを、Agent Harness（Flue）で作ったImprovement Agentと対話しながら継続的に改善するハンズオンです。

題材は、[松尾研究所テックブログ](https://zenn.dev/p/mkj)（Zenn）の記事をKnowledge Sourceにしたチャットボットです。読者の質問に記事の内容で答え、根拠にした記事を案内します。

## 必要なもの

- Python 3.12 以上と [uv](https://docs.astral.sh/uv/)
- Node.js 22.19 以上（推奨: 24。`.node-version` で指定）と [pnpm](https://pnpm.io/)
- OpenAI API キー（このハンズオンで使う外部LLM APIはOpenAIのみです）

コマンドはすべて `pnpm <スクリプト名>` で実行します。

## セットアップ

### 1. 依存関係のインストール

```bash
pnpm install   # Node の依存関係と、Python の依存関係（uv sync）をまとめて入れる
```

### 2. 環境変数

```bash
cp .env.example .env
# .env を開いて OPENAI_API_KEY を設定する
```

### 3. Knowledge の取得

チャットボットが参照するKnowledgeは、松尾研究所テックブログの記事です。取得したファイルはリポジトリに含めていないので、セットアップ時に一度だけ実行してください。

```bash
pnpm knowledge
```

`scripts/fetch_knowledge.py` が、ZennのAPIからPublication（`mkj`）の全記事（作成時点で168件）を取得してMarkdownに変換し、`apps/chatbot/knowledge/<記事のslug>.md` に保存します。リクエストの間隔は1秒空けているので、3〜4分かかります。各ファイルの先頭には、記事のメタデータをfront matterとして記録します。

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

初期状態のチャットボットは、このfront matterのうち `title` と `source` しかインデックスに入れておらず、回答の生成時にはチャンクの本文しかLLMに渡していません。著者や公開日を使えるようにするのも、改善の題材のひとつです。

> **Note**
> Knowledgeは実行した時点のブログの内容です。記事が追加・更新されるとチャットボットの回答やEvalのスコアが変わることがあります。ハンズオン当日は、全員が同じ日に取得した状態で始めることを推奨します。

### 4. インデックスの作成

取得したKnowledgeをチャンクに分割してEmbeddingを作り、FAISSのインデックスを `apps/chatbot/index/` に作成します。Knowledgeを取得し直したときや、チャンク分割の設定を変えたときも再実行してください。

```bash
pnpm ingest
```

### 5. 初期スコアの測定

セットアップの最後に、初期状態のBotでEvalを1回実行しておきます。これが改善前（Before）の基準になります。

```bash
pnpm eval:baseline
```

初期Botは意図的に未成熟な作りなので、全部は合格しません。参考までに、作成時の結果は3回の平均で約 9 / 21（43%）でした。LLM Judgeの判定やBotの回答の揺れにより、1回ごとに数件前後します。

## 起動する

```bash
pnpm dev
```

ブラウザで http://localhost:5173 を開きます。`pnpm dev` は次の3つをまとめて起動します。止めるときは Ctrl+C を押します。

| プロセス | ポート | 役割 |
| --- | --- | --- |
| `apps/chatbot/server.py`（FastAPI） | 8000 | チャットボットのAPI。回答の生成とTraceの保存・取得 |
| `apps/improver`（Flue） | 8787 | Improvement AgentとEval結果の閲覧API |
| `apps/ui`（Vite + React） | 5173 | 画面。上の2つのAPIへ中継（プロキシ）する |

チャットボットのAPIは、Improvement AgentがPythonのコードを変更すると自動で再起動します。

### Chat 画面（`/chat/<session_id>`）

問い合わせチャットボットと会話する画面です。各回答の「Trace」を開くと、検索クエリと取得したドキュメントを確認できます。

会話はTraceとして `workspace/traces/chat/<session_id>/` に保存されるので、URLを開き直すといつでも同じ会話を復元できます。

回答に問題があれば「この会話をImproverに共有」を押してください。会話のURLが入った状態でImprover画面が開きます。

### Improver 画面（`/improve/<session_id>`）

Improvement Agentと会話する画面です。Agentの返答に加えて、ツールの実行状況（チャットボットへの質問、ファイルの編集、Evalの実行など）が順に表示されます。Evalを実行すると、Before / After の結果カードが会話の中に出ます。

右側のパネルでは、これまでのEval結果の一覧と詳細を確認できます。詳細では、ケースごとの合否、回答、判定理由が見られ、ほかの結果と比較することもできます。

チャットのURLを渡されたAgentは、`load_chat_session` ツールでその会話のTraceを読み込み、問題の回答がどのように作られたかを調べてから修正に入ります。

### コストの表示

OpenAI APIの推定コスト（USD）を画面に表示します。

| 場所 | 表示内容 |
| --- | --- |
| Chat画面 | 回答ごとのコスト（Traceの中）と、会話の合計 |
| Eval結果 | 1回のEval全体のコストと、その内訳（チャットボット分とLLM Judge分） |
| Improver画面 | 応答ごとのコストと、セッション合計。合計の内訳は Agent自身（gpt-5.6-terra）、チャットボットへの質問、Evalの3つ |

コストはトークン数に `pricing.yaml` の単価を掛けて計算した推定値です。チャットボットとEvalの呼び出しは `settings.openai_client()` を経由すると自動で記録されます（`apps/chatbot/usage.py`）。Improver自身のコストはFlueが計算した値をそのまま使っています。

目安として、Eval 1回（21ケース）は約 $0.20 で、そのほとんどがLLM Judge（gpt-5.6-terra）の分です。

## CLIでチャットボットを動かす

```bash
# 対話モード（検索されたドキュメントも表示）
pnpm chat

# 1問だけ質問する
uv run python apps/chatbot/run.py "MCPを入門したいのですが、おすすめの記事はありますか？"
```

回答するたびに、`workspace/traces/chat/<session_id>/` へTraceがJSONで保存されます。

```json
{
  "question": "...",
  "search_query": "...",
  "retrieved_documents": [{"id": "faq#3", "title": "...", "score": 0.61, "text": "..."}],
  "answer": "...",
  "metadata": {"latency_sec": 2.1, "config": {"...": "..."}}
}
```

## チャットボットの構成

```text
START → retrieve → generate → END
```

| ファイル | 役割 |
| --- | --- |
| `apps/chatbot/graph.py` | LangGraph（retrieve / generate の2ノード） |
| `apps/chatbot/retriever.py` | FAISSによるセマンティック検索 |
| `apps/chatbot/ingest.py` | チャンク分割、Embedding、インデックス作成 |
| `apps/chatbot/run.py` | CLI、Trace出力 |
| `apps/chatbot/server.py` | チャットボットのAPI（FastAPI） |
| `apps/chatbot/config.yaml` | モデル、チャンク分割、top_k の設定 |
| `apps/chatbot/prompts/` | システムプロンプト、回答プロンプト |

初期状態のチャットボットは、最初に作ったRAGにありがちなシンプルな作りにしてあります。検索クエリは最新の質問をそのまま使い、取得件数は `top_k=3` です。回答の根拠チェックや会話文脈を踏まえた検索はありません。これらをImprovement Agentとの対話で改善していくのが、このハンズオンの本題です。

## Eval

```bash
pnpm eval            # 全ケースを実行し、直前の結果と比較する
pnpm eval:compare    # 最新2回の結果を比較する

# 一部のケースだけ実行する
uv run python evals/run_eval.py --case hard-unknown-topic
uv run python evals/run_eval.py --category hard --repeat 3
```

| ファイル | 役割 |
| --- | --- |
| `evals/cases.yaml` | Eval Case（21件。easy / normal / hard） |
| `evals/graders.py` | 決定的チェック（必須キーワード、禁止表現、取得ドキュメント、文字数）と、LLM Judge（`gpt-5.6-terra`、Structured Output） |
| `evals/run_eval.py` | Evalの実行。結果は `evals/results/`、Traceは `workspace/traces/eval/` に保存 |
| `evals/compare.py` | Before / After の比較 |

LLM Judgeは、全ケースで correctness と groundedness を判定します。ケースによっては、さらに completeness、conciseness、unknown_handling、citation（根拠にした記事を正しく示しているか）、conversation_context も判定します。Judgeには、取得したチャンクの本文と、タイトル・著者・公開日・URLのうちチャンクに含まれているものを渡します。決定的チェックとLLM Judgeの両方に合格したケースだけがPASSになります。

LLM Judgeの判定やBotの回答には多少のぶれがあり、同じBotでも数件スコアが揺れることがあります。気になるケースは `--repeat 3` で確かめてください。

## Improvement Agent（CLI）

Flueで実装した、チャットボットを改善するAgentです。自然言語で改善を依頼すると、問題の再現、Traceの調査、原因の特定、Eval Caseの追加、修正、全Eval、Before / After の比較までを自律的に行います。Improver画面のほか、CLIからも使えます。

Flueで何をどう作っているかは [docs/flue.md](docs/flue.md) にまとめています。

```bash
pnpm improve --id demo-1 -m "「uvとDockerでPythonの開発環境を作る記事を書いたのは誰？」への回答がおかしいです。改善してください。"

# 同じ --id で続けて依頼すると、前のやり取りを踏まえて対応します
pnpm improve --id demo-1 -m "回答がまだ長いので、もっと端的にしてください。"
```

`--id` はFlueのエージェントIDで、改善セッションのIDとして使っています。会話の履歴は `apps/improver/.data/flue.db` に保存され、CLIと画面で共有されます。CLIで始めたセッションも、`/improve/<id>` を開けば画面から続けられます。

> **Warning**
> Flue CLIは必ず `pnpm improve` で実行してください。`npx flue` はローカルのCLIが見つからない場合に、npmにある同名の無関係なパッケージをダウンロードして実行してしまいます。

| ファイル | 役割 |
| --- | --- |
| `apps/improver/src/agents/improver.ts` | Agent本体（モデル: `openai/gpt-5.6-terra`） |
| `apps/improver/src/workspace.ts` | ファイルアクセスを制限したワークスペース |
| `apps/improver/src/tools.ts` | チャットボット実行、Eval実行、比較、インデックス再作成などのツール |
| `apps/improver/skills/rag-debugging/` | 失敗の原因の層（検索、根拠付け、会話文脈など）を切り分けるSkill |
| `apps/improver/skills/eval-driven-improvement/` | 回帰Eval → 修正 → 全Eval → 比較 の手順を守らせるSkill |

### Agentにできること・できないこと

| | 範囲 |
| --- | --- |
| 読める | `apps/chatbot/`、`evals/`、`workspace/traces/` |
| 書ける | `apps/chatbot/`、`evals/cases.yaml` |
| コマンド | 用意したツールのみ（シェルは使えません） |
| 触れない | `.env`、`.git/`、採点ロジック（`evals/graders.py`、`evals/run_eval.py`） |

採点ロジックを編集できないようにしているのは、AgentがBotではなくEvalのほうを甘くして合格させるのを防ぐためです。同じ理由で、既存のEval Caseを緩めることもSkillで禁止しています。

## 開発

```bash
pnpm lint     # ruff（lint / format チェック）と TypeScript の型チェック
pnpm format   # ruff で自動修正と整形
```
