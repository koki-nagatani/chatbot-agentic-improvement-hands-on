/**
 * The Improvement API server (vite dev → http://localhost:8787).
 *
 * - /api/agents/improver/:id   Flue Improvement Agent (id = improvement session id)
 * - /api/evals                 eval result list
 * - /api/evals/:runId          one eval result
 * - /api/evals/compare?before=&after=
 *
 * The chatbot itself is served separately by apps/chatbot/server.py.
 */
import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Improver } from './agents/improver.ts';
import { compare, listResults, readResult } from './evals.ts';

const app = new Hono();

app.route('/api/agents/improver', createAgentRouter(Improver));

app.get('/api/evals', async (c) => c.json(await listResults()));

app.get('/api/evals/compare', async (c) => {
	const before = c.req.query('before');
	const after = c.req.query('after');
	if (!before || !after) return c.json({ error: 'before and after are required' }, 400);
	return c.json(compare(await readResult(before), await readResult(after)));
});

app.get('/api/evals/:runId', async (c) => {
	try {
		return c.json(await readResult(c.req.param('runId')));
	} catch {
		return c.json({ error: 'not found' }, 404);
	}
});

export default app;
