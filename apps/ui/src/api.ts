/** Types and fetch helpers for the chatbot API (:8000) and the eval API (:8787). */

export interface RetrievedDoc {
	id: string;
	title: string;
	source: string;
	score: number;
	text: string;
}

export interface Trace {
	id: string;
	session_id: string;
	timestamp: string;
	question: string;
	search_query: string;
	retrieved_documents: RetrievedDoc[];
	answer: string;
	/** Absent on traces saved before cost tracking existed. */
	usage?: Usage;
	metadata: { latency_sec: number };
	trace_path: string;
}

export interface Usage {
	calls: number;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
}

export interface EvalCost {
	bot_usd: number;
	judge_usd: number;
	total_usd: number;
}

export interface ChatSessionSummary {
	session_id: string;
	turns: number;
	updated: string;
	title: string;
}

export interface Rate {
	passed: number;
	total: number;
	rate: number;
}

export interface EvalListItem {
	run_id: string;
	timestamp: string;
	cases: number;
	overall: Rate;
	cost?: EvalCost;
	git: { commit: string; dirty: boolean };
}

export interface EvalRun {
	pass: boolean;
	question: string;
	history: { role: string; content: string }[];
	search_query: string;
	retrieved: string[];
	answer: string;
	checks: { check: string; target: unknown; pass: boolean; matched?: string }[];
	judge: { criterion: string; pass: boolean; reason: string }[];
	trace_path: string;
	cost?: { bot_usd: number; judge_usd: number };
}

export interface EvalResult {
	run_id: string;
	timestamp: string;
	summary: Record<string, Rate>;
	cost?: EvalCost;
	cases: { id: string; category: string; runs: EvalRun[] }[];
}

export interface Comparison {
	before: string;
	after: string;
	rows: { key: string; before: number | null; after: number | null }[];
	changes: { id: string; before: string; after: string }[];
}

async function json<T>(res: Response): Promise<T> {
	if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
	return res.json() as Promise<T>;
}

export const api = {
	chat: (question: string, sessionId?: string) =>
		fetch('/api/chat', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ question, session_id: sessionId }),
		}).then(json<Trace>),
	chatSession: (id: string) =>
		fetch(`/api/chat/sessions/${id}`).then(json<{ session_id: string; turns: Trace[] }>),
	chatSessions: () => fetch('/api/chat/sessions').then(json<ChatSessionSummary[]>),
	evals: () => fetch('/api/evals').then(json<EvalListItem[]>),
	evalResult: (runId: string) => fetch(`/api/evals/${runId}`).then(json<EvalResult>),
	compare: (before: string, after: string) =>
		fetch(`/api/evals/compare?before=${before}&after=${after}`).then(json<Comparison>),
};

export const pct = (rate: number | null | undefined) =>
	rate == null ? '-' : `${Math.round(rate * 100)}%`;

/** USD with enough precision for sub-cent amounts: $0.0004, $0.038, $1.24 */
export const usd = (value: number | null | undefined) => {
	if (value == null) return '-';
	if (value === 0) return '$0';
	return `$${value < 0.01 ? value.toFixed(4) : value < 1 ? value.toFixed(3) : value.toFixed(2)}`;
};

/** "category:easy" → "easy", "criterion:groundedness" → "groundedness" */
export const metricLabel = (key: string) => key.replace(/^(category|criterion):/, '');
