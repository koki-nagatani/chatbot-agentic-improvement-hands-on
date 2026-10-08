/**
 * Fixed tools for the Improvement Agent. Each one runs a predetermined command in
 * the repository; the model only supplies arguments, never a shell command line.
 */
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineTool } from '@flue/runtime';
import * as v from 'valibot';
import { compare, readResult } from './evals.ts';
import { canRead, REPO_ROOT, toRepoPath } from './workspace.ts';

const MAX_OUTPUT = 20_000;

function truncate(text: string): string {
	return text.length <= MAX_OUTPUT
		? text
		: `${text.slice(0, MAX_OUTPUT)}\n... (truncated ${text.length - MAX_OUTPUT} chars)`;
}

function run(cmd: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			cmd,
			args,
			{ cwd: REPO_ROOT, timeout: timeoutMs, signal, maxBuffer: 20 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(truncate(`Command failed: ${error.message}\n${stderr}\n${stdout}`)));
					return;
				}
				resolve(stdout);
			},
		);
	});
}

const python = (args: string[], timeoutMs: number, signal?: AbortSignal) =>
	run('uv', ['run', 'python', ...args], timeoutMs, signal);

const Turn = v.object({ role: v.picklist(['user', 'assistant']), content: v.string() });

export const askChatbot = defineTool({
	name: 'ask_chatbot',
	description:
		'Ask the current chatbot one question and get its trace: search_query, retrieved_documents (id, title, score, text), answer, trace_path. Pass prior turns in `history` to reproduce a multi-turn conversation.',
	input: v.object({
		question: v.string(),
		history: v.optional(v.array(Turn)),
	}),
	async run({ data, signal }) {
		const args = ['apps/chatbot/run.py', '--json', data.question];
		if (data.history?.length) args.push('--history-json', JSON.stringify(data.history));
		const trace = JSON.parse(await python(args, 180_000, signal));
		delete trace.metadata?.config;
		return { output: trace };
	},
});

export const runEval = defineTool({
	name: 'run_eval',
	description:
		'Run the eval suite against the current chatbot. Returns run_id, summary (pass rates overall / per category / per criterion), comparison (when compare_to is given), and the full text report with failing cases and judge reasons. Runs the full suite unless `cases` or `category` is given. Use `compare_to` with a previous run id (or "latest") for a Before / After comparison.',
	input: v.object({
		cases: v.optional(v.array(v.string())),
		category: v.optional(v.picklist(['easy', 'normal', 'hard'])),
		repeat: v.optional(v.number()),
		label: v.optional(v.string('Short suffix for the run id, e.g. "before" or "after-retrieval"')),
		compare_to: v.optional(v.string()),
	}),
	async run({ data, signal, log }) {
		const args = ['evals/run_eval.py'];
		for (const id of data.cases ?? []) args.push('--case', id);
		if (data.category) args.push('--category', data.category);
		if (data.repeat) args.push('--repeat', String(data.repeat));
		if (data.label) args.push('--label', data.label.replace(/[^\w.-]/g, '-'));
		if (data.compare_to) args.push('--compare', data.compare_to);
		log.info('Running evals...');
		const report = await python(args, 900_000, signal);

		const runId = report.match(/^Saved: evals\/results\/(.+)\.json$/m)?.[1];
		if (!runId) return truncate(report);
		const after = await readResult(runId);
		const beforeId = report.match(/^=== Compare {2}before=(\S+)/m)?.[1];
		const output = {
			run_id: runId,
			cases: after.cases.length,
			summary: after.summary,
			cost: after.cost,
			comparison: beforeId ? compare(await readResult(beforeId), after) : undefined,
			report: truncate(report),
		};
		// Round-trip through JSON to get a plain JSON value (drops undefined fields).
		return { output: JSON.parse(JSON.stringify(output)) };
	},
});

export const compareEvals = defineTool({
	name: 'compare_evals',
	description:
		'Compare two eval results (Before / After): pass rates per category and criterion, and cases that changed between PASS and FAIL. Arguments are run ids or file names in evals/results/.',
	input: v.object({ before: v.string(), after: v.string() }),
	async run({ data, signal }) {
		return python(['evals/compare.py', data.before, data.after], 60_000, signal);
	},
});

export const listEvalResults = defineTool({
	name: 'list_eval_results',
	description: 'List saved eval result run ids (oldest first) with their overall score.',
	async run() {
		const dir = path.join(REPO_ROOT, 'evals', 'results');
		const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
		const rows = await Promise.all(
			files.map(async (f) => {
				const result = JSON.parse(await readFile(path.join(dir, f), 'utf-8'));
				const o = result.summary.overall;
				return `${result.run_id}  ${o.passed}/${o.total} (${Math.round(o.rate * 100)}%)`;
			}),
		);
		return rows.join('\n') || 'No eval results yet.';
	},
});

export const rebuildIndex = defineTool({
	name: 'rebuild_index',
	description:
		'Rebuild the FAISS index from apps/chatbot/knowledge/. Required after changing chunking settings, the embedding model, ingest.py, or knowledge files.',
	async run({ signal }) {
		return python(['apps/chatbot/ingest.py'], 600_000, signal);
	},
});

export const showDiff = defineTool({
	name: 'show_diff',
	description:
		'Show uncommitted changes made to the chatbot and eval cases (git diff of apps/chatbot and evals/cases.yaml, plus new files).',
	async run({ signal }) {
		const paths = ['apps/chatbot', 'evals/cases.yaml'];
		const status = await run('git', ['status', '--porcelain', '--', ...paths], 30_000, signal);
		const diff = await run('git', ['diff', '--', ...paths], 30_000, signal);
		return truncate(`# git status\n${status || '(clean)'}\n\n# git diff\n${diff || '(no diff)'}`);
	},
});

export const listFiles = defineTool({
	name: 'list_files',
	description:
		'List files under a readable directory (apps/chatbot, evals, workspace/traces). Directories end with "/".',
	input: v.object({
		dir: v.string('Repository-relative directory, e.g. "apps/chatbot"'),
		recursive: v.optional(v.boolean()),
	}),
	async run({ data }) {
		const root = path.resolve(REPO_ROOT, data.dir);
		if (!canRead(`${root}/`)) throw new Error(`Access denied: ${data.dir}`);
		const out: string[] = [];
		async function walk(dir: string) {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				const abs = path.join(dir, entry.name);
				if (!canRead(abs)) continue;
				out.push(`${toRepoPath(abs)}${entry.isDirectory() ? '/' : ''}`);
				if (entry.isDirectory() && data.recursive) await walk(abs);
			}
		}
		await walk(root);
		return truncate(out.sort().join('\n'));
	},
});

export const searchFiles = defineTool({
	name: 'search_files',
	description:
		'Search readable files (apps/chatbot, evals, workspace/traces) for a regular expression. Returns matching lines as path:line: text. Useful to check whether the knowledge mentions something.',
	input: v.object({
		pattern: v.string('JavaScript regular expression'),
		dir: v.optional(v.string('Repository-relative directory, default "apps/chatbot"')),
		max_results: v.optional(v.number()),
	}),
	async run({ data }) {
		const re = new RegExp(data.pattern, 'i');
		const root = path.resolve(REPO_ROOT, data.dir ?? 'apps/chatbot');
		if (!canRead(`${root}/`)) throw new Error(`Access denied: ${data.dir}`);
		const limit = data.max_results ?? 50;
		const hits: string[] = [];
		async function walk(dir: string) {
			for (const entry of await readdir(dir, { withFileTypes: true })) {
				if (hits.length >= limit) return;
				const abs = path.join(dir, entry.name);
				if (!canRead(abs)) continue;
				if (entry.isDirectory()) {
					await walk(abs);
				} else if (/\.(md|py|ya?ml|json|txt)$/.test(entry.name)) {
					const lines = (await readFile(abs, 'utf-8')).split('\n');
					lines.forEach((line, i) => {
						if (hits.length < limit && re.test(line)) {
							hits.push(`${toRepoPath(abs)}:${i + 1}: ${line.slice(0, 200)}`);
						}
					});
				}
			}
		}
		await walk(root);
		return hits.join('\n') || 'No matches.';
	},
});

export const loadChatSession = defineTool({
	name: 'load_chat_session',
	description:
		'Load a chat session the user shared, by its URL (e.g. http://localhost:5173/chat/<session_id>) or session id. Returns every turn in order with its trace: question, history, search_query, retrieved_documents, answer, trace_path. Use this when the user shares a chat URL, then reproduce with ask_chatbot passing the same history.',
	input: v.object({ session: v.string('Chat URL or session id') }),
	async run({ data }) {
		const id = data.session.trim().match(/(?:\/chat\/)?([A-Za-z0-9]+)\/?(?:[?#].*)?$/)?.[1];
		if (!id) throw new Error(`Could not find a session id in: ${data.session}`);
		const dir = path.join(REPO_ROOT, 'workspace', 'traces', 'chat', id);
		let files: string[];
		try {
			files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
		} catch {
			throw new Error(`Chat session not found: ${id}`);
		}
		const turns = await Promise.all(
			files.map(async (f) => {
				const trace = JSON.parse(await readFile(path.join(dir, f), 'utf-8'));
				delete trace.metadata?.config;
				return { ...trace, trace_path: `workspace/traces/chat/${id}/${f}` };
			}),
		);
		return { output: { session_id: id, turns } };
	},
});

export const improverTools = [
	loadChatSession,
	askChatbot,
	runEval,
	compareEvals,
	listEvalResults,
	rebuildIndex,
	showDiff,
	listFiles,
	searchFiles,
];
