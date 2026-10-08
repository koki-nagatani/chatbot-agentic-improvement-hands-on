import { type FlueConversationMessage, type FlueConversationPart, useFlueAgent } from '@flue/react';
import { type FormEvent, type KeyboardEvent, useEffect, useState } from 'react';
import { type Comparison, type EvalCost, metricLabel, pct, usd } from './api.ts';
import { Delta } from './Delta.tsx';
import { EvalPanel } from './EvalPanel.tsx';
import { navigate, newId } from './router.ts';

const RECENT_KEY = 'improver.recentSessions';

function loadRecent(): string[] {
	try {
		return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
	} catch {
		return [];
	}
}

function rememberSession(id: string) {
	try {
		const recent = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 20);
		localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
	} catch {
		// Storage unavailable: the session list is a convenience only.
	}
}

/** The Improvement Agent chat. /improve/<session_id> is the Flue agent id. */
export function ImproverPage({ sessionId, draft }: { sessionId?: string; draft?: string }) {
	useEffect(() => {
		if (!sessionId) {
			const query = draft ? `?draft=${encodeURIComponent(draft)}` : '';
			navigate(`/improve/${newId()}${query}`, { replace: true });
		}
	}, [sessionId, draft]);

	if (!sessionId) return null;
	return <ImproverSession key={sessionId} sessionId={sessionId} draft={draft} />;
}

function ImproverSession({ sessionId, draft }: { sessionId: string; draft?: string }) {
	const agent = useFlueAgent({ url: `/api/agents/improver/${sessionId}` });
	const [input, setInput] = useState(draft ?? '');
	const [error, setError] = useState<string>();
	const [selectedRun, setSelectedRun] = useState<string>();
	const [recent, setRecent] = useState(loadRecent);
	const busy = agent.status === 'submitted' || agent.status === 'streaming';

	async function send(event?: FormEvent) {
		event?.preventDefault();
		const message = input.trim();
		if (!message) return;
		setInput('');
		setError(undefined);
		if (draft) navigate(`/improve/${sessionId}`, { replace: true });
		try {
			await agent.sendMessage(message);
			rememberSession(sessionId);
			setRecent(loadRecent());
		} catch (e) {
			setInput(message);
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
	}

	const cost = sessionCost(agent.messages);

	// Refresh the eval list whenever the agent finishes a response.
	const evalRefreshKey = `${agent.messages.length}:${busy}`;

	return (
		<div className="layout three">
			<aside className="sidebar">
				<button type="button" className="primary" onClick={() => navigate('/improve')}>
					＋ 新しい改善セッション
				</button>
				<h3>最近のセッション</h3>
				<ul className="session-list">
					{[sessionId, ...recent.filter((id) => id !== sessionId)].map((id) => (
						<li key={id}>
							<a
								href={`/improve/${id}`}
								className={id === sessionId ? 'active' : ''}
								onClick={(e) => {
									e.preventDefault();
									navigate(`/improve/${id}`);
								}}
							>
								<span className="title mono">{id}</span>
							</a>
						</li>
					))}
				</ul>
			</aside>

			<main className="conversation">
				<div className="conversation-header">
					<h2>Improvement Agent</h2>
					<div className="header-actions">
						<span
							className="cost"
							title={`Agent ${usd(cost.agent)} / チャットボットへの質問 ${usd(cost.bot)} / Eval ${usd(cost.evals)}`}
						>
							セッション合計 {usd(cost.agent + cost.bot + cost.evals)}
							<span className="muted">
								{' '}
								（Agent {usd(cost.agent)} · Bot {usd(cost.bot)} · Eval {usd(cost.evals)}）
							</span>
						</span>
						<span className={`status ${agent.status}`}>{busy ? '作業中…' : agent.status}</span>
					</div>
				</div>

				<div className="messages">
					{agent.historyReady && agent.messages.length === 0 && (
						<p className="empty">
							チャットボットの回答の問題点や改善要望を伝えてください。チャット画面の「この会話をImproverに共有」から会話のURLを渡すこともできます。
						</p>
					)}
					{agent.messages.map((m) => (
						<Message key={m.id} message={m} onOpenRun={setSelectedRun} />
					))}
				</div>

				{(error || agent.error) && <p className="error">{error ?? agent.error?.message}</p>}

				<form className="composer" onSubmit={send}>
					<textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={onKeyDown}
						rows={3}
						placeholder="例: 「uvとDockerでPythonの開発環境を作る記事を書いたのは誰？」への回答がおかしいです。改善してください。（⌘+Enterで送信）"
					/>
					<div className="composer-actions">
						{busy && (
							<button
								type="button"
								onClick={() =>
									fetch(`/api/agents/improver/${sessionId}/abort`, { method: 'POST' })
								}
							>
								中断
							</button>
						)}
						<button type="submit" className="primary" disabled={!input.trim()}>
							送信
						</button>
					</div>
				</form>
			</main>

			<EvalPanel selected={selectedRun} onSelect={setSelectedRun} refreshKey={evalRefreshKey} />
		</div>
	);
}

function Message({
	message,
	onOpenRun,
}: {
	message: FlueConversationMessage;
	onOpenRun: (runId: string) => void;
}) {
	if (message.role === 'system') return null;
	const usage = responseUsage(message);
	return (
		<div className={`bubble ${message.role}`}>
			{message.parts.map((part, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: parts are append-only within a message
				<Part key={i} part={part} onOpenRun={onOpenRun} />
			))}
			{usage && (
				<div className="message-footer muted">
					{usd(usage.cost.total)} · {usage.totalTokens.toLocaleString()} tokens
				</div>
			)}
		</div>
	);
}

interface ResponseUsage {
	totalTokens: number;
	cost: { total: number };
}

/** Usage stamped on the response metadata by the agent's useResponseFinish hook. */
function responseUsage(message: FlueConversationMessage): ResponseUsage | undefined {
	const usage = message.metadata?.usage as ResponseUsage | undefined;
	return usage?.cost ? usage : undefined;
}

/** Session cost in USD: the agent's own model calls, plus what its tools spent on the chatbot and evals. */
function sessionCost(messages: FlueConversationMessage[]) {
	const cost = { agent: 0, bot: 0, evals: 0 };
	for (const message of messages) {
		cost.agent += responseUsage(message)?.cost.total ?? 0;
		for (const part of message.parts) {
			if (part.type !== 'dynamic-tool' || part.state !== 'output-available') continue;
			const output = part.output as Record<string, unknown> | null;
			if (part.toolName === 'ask_chatbot') {
				cost.bot += (output?.usage as { cost_usd?: number } | undefined)?.cost_usd ?? 0;
			} else if (part.toolName === 'run_eval') {
				cost.evals += (output?.cost as EvalCost | undefined)?.total_usd ?? 0;
			}
		}
	}
	return cost;
}

function Part({ part, onOpenRun }: { part: FlueConversationPart; onOpenRun: (runId: string) => void }) {
	if (part.type === 'text') return <div className="text">{part.text}</div>;
	if (part.type === 'reasoning') {
		return part.text ? (
			<details className="reasoning">
				<summary>思考</summary>
				<div className="text">{part.text}</div>
			</details>
		) : null;
	}
	if (part.type === 'dynamic-tool') return <ToolCall part={part} onOpenRun={onOpenRun} />;
	return null;
}

const TOOL_LABELS: Record<string, string> = {
	ask_chatbot: 'チャットボットに質問',
	run_eval: 'Evalを実行',
	compare_evals: 'Evalを比較',
	list_eval_results: 'Eval結果一覧',
	load_chat_session: 'チャットのTraceを読み込み',
	rebuild_index: 'インデックス再作成',
	show_diff: '差分を確認',
	list_files: 'ファイル一覧',
	search_files: 'ファイル検索',
	read: 'ファイルを読む',
	write: 'ファイルを書く',
	edit: 'ファイルを編集',
	activate_skill: 'Skillを読み込み',
};

type ToolPart = Extract<FlueConversationPart, { type: 'dynamic-tool' }>;

function toolSummary(part: ToolPart): string {
	const input = (part.input ?? {}) as Record<string, unknown>;
	const value =
		input.path ?? input.question ?? input.session ?? input.name ?? input.pattern ?? input.dir;
	if (part.toolName === 'run_eval') {
		const cases = input.cases as string[] | undefined;
		return cases?.length ? cases.join(', ') : (input.category as string) ?? '全ケース';
	}
	return typeof value === 'string' ? value : '';
}

function ToolCall({ part, onOpenRun }: { part: ToolPart; onOpenRun: (runId: string) => void }) {
	const icon = part.state === 'input-available' ? '⏳' : part.state === 'output-error' ? '✗' : '✓';
	const output = part.state === 'output-available' ? part.output : undefined;
	const evalOutput =
		part.toolName === 'run_eval' && output && typeof output === 'object' && 'run_id' in output
			? (output as EvalToolOutput)
			: undefined;

	return (
		<div className={`tool ${part.state}`}>
			<details>
				<summary>
					<span className="icon">{icon}</span>
					<span className="tool-name">{TOOL_LABELS[part.toolName] ?? part.toolName}</span>
					<span className="muted">{toolSummary(part)}</span>
					{part.durationMs != null && (
						<span className="muted duration">{(part.durationMs / 1000).toFixed(1)}s</span>
					)}
				</summary>
				<div className="tool-body">
					<h4>入力</h4>
					<pre>{JSON.stringify(part.input, null, 2)}</pre>
					{part.state === 'output-error' && <pre className="error">{part.errorText}</pre>}
					{output !== undefined && (
						<>
							<h4>出力</h4>
							<pre>
								{typeof output === 'string' ? output : JSON.stringify(output, null, 2)}
							</pre>
						</>
					)}
				</div>
			</details>
			{evalOutput && <EvalCard result={evalOutput} onOpen={() => onOpenRun(evalOutput.run_id)} />}
		</div>
	);
}

interface EvalToolOutput {
	run_id: string;
	cases: number;
	cost?: EvalCost;
	summary: Record<string, { passed: number; total: number; rate: number }>;
	comparison?: Comparison;
}

function EvalCard({ result, onOpen }: { result: EvalToolOutput; onOpen: () => void }) {
	const overall = result.summary.overall;
	const cmp = result.comparison;
	const changedRows = cmp?.rows.filter((r) => r.key !== 'overall' && r.before !== r.after) ?? [];
	const overallRow = cmp?.rows.find((r) => r.key === 'overall');

	return (
		<div className="eval-card">
			<div className="eval-card-head">
				<strong>Eval結果</strong>
				<span className="mono muted">{result.run_id}</span>
			</div>
			<div className="eval-card-score">
				{overallRow ? (
					<>
						{pct(overallRow.before)} → <strong>{pct(overallRow.after)}</strong>
						<Delta before={overallRow.before} after={overallRow.after} />
					</>
				) : (
					<strong>{pct(overall.rate)}</strong>
				)}
				<span className="muted">
					{' '}
					({overall.passed}/{overall.total})
				</span>
				{result.cost && <span className="muted eval-card-cost">{usd(result.cost.total_usd)}</span>}
			</div>
			{changedRows.length > 0 && (
				<table className="mini">
					<tbody>
						{changedRows.map((r) => (
							<tr key={r.key}>
								<td>{metricLabel(r.key)}</td>
								<td>
									{pct(r.before)} → {pct(r.after)} <Delta before={r.before} after={r.after} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}
			{cmp && cmp.changes.length > 0 && (
				<ul className="changes">
					{cmp.changes.map((c) => (
						<li key={c.id}>
							<span className="mono">{c.id}</span>{' '}
							<span className={c.after === 'PASS' ? 'pass' : 'fail'}>
								{c.before} → {c.after}
							</span>
						</li>
					))}
				</ul>
			)}
			<button type="button" onClick={onOpen}>
				詳細を見る
			</button>
		</div>
	);
}
