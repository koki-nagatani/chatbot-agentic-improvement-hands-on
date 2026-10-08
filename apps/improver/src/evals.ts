/** Read and compare eval results saved by evals/run_eval.py (evals/results/<run_id>.json). */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from './workspace.ts';

const RESULTS_DIR = path.join(REPO_ROOT, 'evals', 'results');
const RUN_ID = /^[\w.-]+$/;

export interface Rate {
	passed: number;
	total: number;
	rate: number;
}

export interface EvalRun {
	pass: boolean;
	question: string;
	history: { role: string; content: string }[];
	search_query: string;
	retrieved: string[];
	answer: string;
	checks: { check: string; target: unknown; pass: boolean; [k: string]: unknown }[];
	judge: { criterion: string; pass: boolean; reason: string }[];
	trace_path: string;
}

export interface EvalResult {
	run_id: string;
	timestamp: string;
	repeat: number;
	git: { commit: string; branch: string; dirty: boolean };
	summary: Record<string, Rate>;
	/** Absent on results saved before cost tracking existed. */
	cost?: { bot_usd: number; judge_usd: number; total_usd: number };
	cases: { id: string; category: string; runs: EvalRun[] }[];
}

export interface Comparison {
	before: string;
	after: string;
	rows: { key: string; before: number | null; after: number | null }[];
	changes: { id: string; before: string; after: string }[];
}

export async function readResult(runId: string): Promise<EvalResult> {
	const id = runId.replace(/\.json$/, '');
	if (!RUN_ID.test(id)) throw new Error(`Invalid run id: ${runId}`);
	return JSON.parse(await readFile(path.join(RESULTS_DIR, `${id}.json`), 'utf-8'));
}

export async function listResults() {
	const files = (await readdir(RESULTS_DIR)).filter((f) => f.endsWith('.json')).sort();
	return Promise.all(
		files.map(async (f) => {
			const r = await readResult(f);
			return {
				run_id: r.run_id,
				timestamp: r.timestamp,
				cases: r.cases.length,
				overall: r.summary.overall,
				cost: r.cost,
				git: r.git,
			};
		}),
	);
}

const status = (c: EvalResult['cases'][number] | undefined) =>
	!c ? 'NEW' : c.runs.every((r) => r.pass) ? 'PASS' : 'FAIL';

export function compare(before: EvalResult, after: EvalResult): Comparison {
	const keys = [
		'overall',
		...[...new Set([...Object.keys(before.summary), ...Object.keys(after.summary)])]
			.filter((k) => k !== 'overall')
			.sort(),
	];
	const prev = new Map(before.cases.map((c) => [c.id, c]));
	return {
		before: before.run_id,
		after: after.run_id,
		rows: keys.map((key) => ({
			key,
			before: before.summary[key]?.rate ?? null,
			after: after.summary[key]?.rate ?? null,
		})),
		changes: after.cases
			.map((c) => ({ id: c.id, before: status(prev.get(c.id)), after: status(c) }))
			.filter((c) => c.before !== c.after),
	};
}
