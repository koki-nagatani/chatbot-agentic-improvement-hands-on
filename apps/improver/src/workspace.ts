/**
 * The Improvement Agent's workspace: the repository root via `local()`, but with
 * the model-facing tools replaced by path-guarded read / write / edit only.
 *
 * - No `bash`: commands run only through the fixed tools in ./tools.
 * - Read:  apps/chatbot/, evals/, workspace/traces/
 * - Write: apps/chatbot/, evals/cases.yaml (graders and the runner stay untouched,
 *          so the agent cannot make the evals easier instead of the bot better)
 * - Never: .env*, .git/, the built FAISS index
 */
import path from 'node:path';
import {
	createEditTool,
	createReadTool,
	createWriteTool,
	type Sandbox,
	type SandboxFactory,
} from '@flue/runtime';
import { local } from '@flue/runtime/node';

export const REPO_ROOT = path.resolve(
	process.env.IMPROVER_WORKSPACE ?? path.join(process.cwd(), '..', '..'),
);

const READ_ROOTS = ['apps/chatbot/', 'evals/', 'workspace/traces/'];
const WRITE_ROOTS = ['apps/chatbot/', 'evals/cases.yaml'];
const DENY = [/(^|\/)\.env/, /(^|\/)\.git(\/|$)/, /^apps\/chatbot\/index(\/|$)/, /__pycache__/];
// Supporting files of packaged skills are served by Flue from this virtual root.
const PACKAGED_SKILLS = '/.flue/packaged-skills/';

/** Repo-relative POSIX path, or null when outside the repository. */
export function toRepoPath(absPath: string): string | null {
	const rel = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
	if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
	return rel;
}

function allowed(rel: string | null, roots: string[]): boolean {
	if (rel === null || DENY.some((re) => re.test(rel))) return false;
	return roots.some((root) => rel === root.replace(/\/$/, '') || rel.startsWith(root));
}

export function canRead(absPath: string): boolean {
	return absPath.startsWith(PACKAGED_SKILLS) || allowed(toRepoPath(absPath), READ_ROOTS);
}

export function canWrite(absPath: string): boolean {
	return allowed(toRepoPath(absPath), WRITE_ROOTS);
}

function guarded(sandbox: Sandbox): Sandbox {
	const check = (p: string, ok: (abs: string) => boolean, verb: string) => {
		const abs = p.startsWith(PACKAGED_SKILLS) ? p : sandbox.resolvePath(p);
		if (!ok(abs)) {
			throw new Error(
				`Access denied: cannot ${verb} ${p}. Readable: ${READ_ROOTS.join(', ')}. Writable: ${WRITE_ROOTS.join(', ')}.`,
			);
		}
		return p;
	};
	return {
		cwd: sandbox.cwd,
		resolvePath: (p) => sandbox.resolvePath(p),
		readFile: (p) => sandbox.readFile(check(p, canRead, 'read')),
		readFileBuffer: (p) => sandbox.readFileBuffer(check(p, canRead, 'read')),
		stat: (p) => sandbox.stat(check(p, canRead, 'read')),
		readdir: (p) => sandbox.readdir(check(p, canRead, 'read')),
		exists: (p) => sandbox.exists(check(p, canRead, 'read')),
		writeFile: (p, content) => sandbox.writeFile(check(p, canWrite, 'write'), content),
		mkdir: (p, options) => sandbox.mkdir(check(p, canWrite, 'write'), options),
		rm: (p, options) => sandbox.rm(check(p, canWrite, 'write'), options),
		exec: async () => {
			throw new Error('Shell access is disabled. Use the provided tools instead.');
		},
	};
}

export function workspace(): SandboxFactory {
	const base = local({ cwd: REPO_ROOT });
	return {
		createSandbox: (options) => base.createSandbox(options),
		tools: (sandbox) => {
			const safe = guarded(sandbox);
			return [createReadTool(safe), createWriteTool(safe), createEditTool(safe)];
		},
	};
}
