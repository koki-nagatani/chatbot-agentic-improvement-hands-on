import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { api, type ChatSessionSummary, type Trace, usd } from './api.ts';
import { navigate } from './router.ts';

/** The inquiry chatbot. /chat/<session_id> restores a past conversation from its traces. */
export function ChatPage({ sessionId }: { sessionId?: string }) {
	const [turns, setTurns] = useState<Trace[]>([]);
	const [pending, setPending] = useState<string>();
	const [input, setInput] = useState('');
	const [error, setError] = useState<string>();
	const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);

	const refreshSessions = useCallback(() => {
		api.chatSessions().then(setSessions).catch(() => {});
	}, []);

	useEffect(refreshSessions, [refreshSessions]);

	useEffect(() => {
		setError(undefined);
		if (!sessionId) {
			setTurns([]);
			return;
		}
		// Skip the reload right after this page created the session itself.
		if (turns.length && turns[0].session_id === sessionId) return;
		api
			.chatSession(sessionId)
			.then((s) => setTurns(s.turns))
			.catch(() => setError(`セッション ${sessionId} が見つかりません`));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sessionId]);

	async function submit(event: FormEvent) {
		event.preventDefault();
		const question = input.trim();
		if (!question || pending) return;
		setInput('');
		setPending(question);
		setError(undefined);
		try {
			const trace = await api.chat(question, sessionId);
			setTurns((prev) => [...prev, trace]);
			if (!sessionId) navigate(`/chat/${trace.session_id}`, { replace: true });
			refreshSessions();
		} catch (e) {
			setInput(question);
			setError(`回答の取得に失敗しました: ${e instanceof Error ? e.message : e}`);
		} finally {
			setPending(undefined);
		}
	}

	function shareWithImprover() {
		const url = `${window.location.origin}/chat/${sessionId}`;
		const draft = `このチャットの回答に問題があります。確認して改善してください。\n${url}\n\n問題点: `;
		navigate(`/improve?draft=${encodeURIComponent(draft)}`);
	}

	return (
		<div className="layout">
			<aside className="sidebar">
				<button type="button" className="primary" onClick={() => navigate('/chat')}>
					＋ 新しい会話
				</button>
				<h3>最近の会話</h3>
				<ul className="session-list">
					{sessions.map((s) => (
						<li key={s.session_id}>
							<a
								href={`/chat/${s.session_id}`}
								className={s.session_id === sessionId ? 'active' : ''}
								onClick={(e) => {
									e.preventDefault();
									navigate(`/chat/${s.session_id}`);
								}}
							>
								<span className="title">{s.title}</span>
								<span className="meta">
									{s.turns}往復 · {s.updated.replace('T', ' ').slice(5, 16)}
								</span>
							</a>
						</li>
					))}
				</ul>
			</aside>

			<main className="conversation">
				<div className="conversation-header">
					<h2>松尾研究所テックブログ チャットボット</h2>
					{sessionId && turns.length > 0 && (
						<div className="header-actions">
							<span className="cost" title="この会話で使ったOpenAI APIの推定コスト">
								会話の合計 {usd(turns.reduce((sum, t) => sum + (t.usage?.cost_usd ?? 0), 0))}
							</span>
							<button type="button" onClick={shareWithImprover}>
								この会話をImproverに共有
							</button>
						</div>
					)}
				</div>

				<div className="messages">
					{turns.length === 0 && !pending && (
						<p className="empty">松尾研究所テックブログの記事について質問してください。</p>
					)}
					{turns.map((t) => (
						<Turn key={t.id} trace={t} />
					))}
					{pending && (
						<>
							<div className="bubble user">{pending}</div>
							<div className="bubble assistant thinking">回答を生成中…</div>
						</>
					)}
				</div>

				{error && <p className="error">{error}</p>}

				<form className="composer" onSubmit={submit}>
					<input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="例: MCPを入門したいのですが、おすすめの記事はありますか？"
						disabled={!!pending}
					/>
					<button type="submit" className="primary" disabled={!input.trim() || !!pending}>
						送信
					</button>
				</form>
			</main>
		</div>
	);
}

function Turn({ trace }: { trace: Trace }) {
	return (
		<>
			<div className="bubble user">{trace.question}</div>
			<div className="bubble assistant">
				<div className="text">{trace.answer}</div>
				<details className="trace">
					<summary>
						Trace · {trace.retrieved_documents.length}件取得 · {trace.metadata.latency_sec}s
						{trace.usage && ` · ${usd(trace.usage.cost_usd)}`}
					</summary>
					<dl>
						<dt>検索クエリ</dt>
						<dd className="mono">{trace.search_query}</dd>
						<dt>取得ドキュメント</dt>
						<dd>
							{trace.retrieved_documents.map((d) => (
								<details key={d.id} className="doc">
									<summary>
										<span className="score">{d.score.toFixed(3)}</span> {d.id}{' '}
										<span className="muted">{d.title}</span>
									</summary>
									<pre>{d.text}</pre>
								</details>
							))}
						</dd>
						{trace.usage && (
							<>
								<dt>コスト</dt>
								<dd>
									{usd(trace.usage.cost_usd)}（API呼び出し {trace.usage.calls}回 · 入力{' '}
									{trace.usage.input_tokens.toLocaleString()} / 出力{' '}
									{trace.usage.output_tokens.toLocaleString()} tokens）
								</dd>
							</>
						)}
						<dt>Trace ID</dt>
						<dd className="mono">{trace.id}</dd>
					</dl>
				</details>
			</div>
		</>
	);
}
