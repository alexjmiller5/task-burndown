import { expect, test, vi } from 'vitest';
import { fetchSomaChunk, getSomaConfig } from './soma.js';

const binding = {
	table: 'work',
	projects: { table: 'initiatives', title: 'label' },
	columns: {
		created: 'original_created',
		completed: 'finished',
		dueDate: 'due',
		status: 'state',
		tags: 'labels',
		priority: 'rank',
		projectIds: 'initiatives',
		aiCompleted: 'ai'
	},
	tagColors: { Chore: 'blue' }
};
const env = {
	SOMA_TASKS_CONFIG: JSON.stringify(binding),
	SOMA_HUB_URL: 'https://example.test',
	SOMA_HUB_TOKEN: 'test-only'
};
const row = {
	id: 't1',
	original_created: '2020-01-01T09:00:00.000Z',
	finished: null,
	due: '2020-02-03',
	state: 'Completed',
	labels: '["Chore"]',
	rank: 'High',
	initiatives: '["p1","p2"]',
	ai: 1,
	updated_at: '2026-01-01T00:00:00.000Z',
	deleted_at: null
};
const reply = (rows: unknown[], next_cursor: string | null = null) =>
	new Response(JSON.stringify({ rows, next_cursor }));

test('unconfigured stays on Notion; partial and malformed Soma bindings fail closed', () => {
	expect(getSomaConfig({})).toBeNull();
	expect(getSomaConfig({ SOMA_TASKS_CONFIG: 'null' })).toBeNull();
	expect(() => getSomaConfig({ SOMA_TASKS_CONFIG: '{}' })).toThrow();
	expect(() => getSomaConfig({ ...env, SOMA_HUB_TOKEN: '' })).toThrow();
	expect(() =>
		getSomaConfig({ ...env, SOMA_TASKS_CONFIG: JSON.stringify({ ...binding, columns: {} }) })
	).toThrow();
});

test('reads every project page and keeps original dates, missing completion, tags and source project order', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(
			reply([{ id: 'p1', label: 'Alpha', deleted_at: null }], 'projects-page2')
		)
		.mockResolvedValueOnce(reply([{ id: 'p2', label: 'Beta', deleted_at: null }]))
		.mockResolvedValueOnce(reply([row], 'tasks-page2'));
	const result = await fetchSomaChunk(getSomaConfig(env)!, null, fetcher);
	expect(result.tasks).toEqual([
		{
			id: 't1',
			created: row.original_created,
			completed: null,
			dueDate: '2020-02-03',
			status: 'Completed',
			tags: ['Chore'],
			priority: 'High',
			projectName: 'Alpha',
			hasProject: true,
			aiCompleted: true,
			lastEditedTime: row.updated_at
		}
	]);
	expect(result.nextCursor).toBe('tasks-page2');
	expect(result.tagColors.Chore).toBe('blue');
	expect(JSON.parse(fetcher.mock.calls[1][1].body).after).toBe('projects-page2');
	const body = JSON.parse(fetcher.mock.calls[2][1].body);
	expect(body.since).toBe('');
	expect(body.columns).toContain('deleted_at');
	expect(body.columns).not.toContain('title');
});

test('passes opaque continuation unchanged, preserves timed dates and distinguishes unresolved links from unlinked', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(reply([]))
		.mockResolvedValueOnce(
			reply([
				{ ...row, initiatives: '["missing"]', due: '2020-02-03T08:15:00.000Z' },
				{ ...row, id: 't2', initiatives: '[]', ai: 0 },
				{ id: 'removed', deleted_at: '2026-01-01' }
			])
		);
	const result = await fetchSomaChunk(getSomaConfig(env)!, 'opaque+=cursor', fetcher);
	expect(JSON.parse(fetcher.mock.calls[1][1].body).after).toBe('opaque+=cursor');
	expect(result.tasks[0]).toMatchObject({
		dueDate: '2020-02-03T08:15:00.000Z',
		hasProject: true,
		projectName: '(Unavailable Project)'
	});
	expect(result.tasks[1]).toMatchObject({
		hasProject: false,
		projectName: '(No Project)',
		aiCompleted: false
	});
	expect(result.deletedIds).toEqual(['removed']);
});

test('rejects invalid page receipts, repeated project cursor, bad rows and failed requests', async () => {
	for (const responses of [
		[new Response('{}')],
		[reply([], 'repeat'), reply([], 'repeat')],
		[reply([]), reply([{ ...row, labels: 'not-json' }])],
		[reply([]), reply([{ ...row, original_created: null }])],
		[reply([]), new Response('private error', { status: 403 })]
	]) {
		const fetcher = vi.fn();
		for (const response of responses) fetcher.mockResolvedValueOnce(response);
		await expect(fetchSomaChunk(getSomaConfig(env)!, null, fetcher)).rejects.toThrow();
	}
});

test('nullable catalog lists and checkbox remain empty rather than becoming invented task facts', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(reply([]))
		.mockResolvedValueOnce(
			reply([{ ...row, labels: null, initiatives: null, ai: null, rank: null, state: null }])
		);
	const result = await fetchSomaChunk(getSomaConfig(env)!, null, fetcher);
	expect(result.tasks[0]).toMatchObject({
		tags: [],
		hasProject: false,
		aiCompleted: false,
		priority: '(No Priority)',
		status: ''
	});
});

test('Notion and Soma rows produce identical chart inputs and completion metrics', async () => {
	const { parseTasks } = await import('$lib/data/parser.js');
	const { calculateCompletions } = await import('$lib/data/metrics.js');
	const { applyBaseFilters } = await import('$lib/data/filters.js');
	const rows = [
		row,
		{ ...row, id: 't2', state: 'To Do' },
		{ ...row, id: 't3', finished: '2020-02-04', ai: 0 }
	];
	const notion = parseTasks(
		rows.map((r) => ({
			id: r.id,
			created_time: r.original_created,
			last_edited_time: r.updated_at,
			archived: false,
			in_trash: false,
			url: 'https://example.test',
			properties: {
				'Date Created': { created_time: r.original_created },
				'Completed Date': { date: r.finished ? { start: r.finished } : null },
				'Due Date': { date: { start: r.due } },
				Status: { status: { name: r.state } },
				Tags: { multi_select: [{ name: 'Chore', color: 'blue' }] },
				Priority: { select: { name: 'High' } },
				'Project Title': {
					rollup: { array: [{ type: 'title', title: [{ plain_text: 'Alpha' }] }] }
				},
				'AI Completed': { checkbox: r.ai === 1 }
			}
		}))
	);
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(reply([{ id: 'p1', label: 'Alpha', deleted_at: null }]))
		.mockResolvedValueOnce(reply(rows));
	const life = await fetchSomaChunk(getSomaConfig(env)!, null, fetcher);
	expect(life.tasks).toEqual(notion.tasks);
	expect(applyBaseFilters(life.tasks).map((t) => t.id)).toEqual(['t2', 't3']);
	expect(
		calculateCompletions(applyBaseFilters(life.tasks), 'UTC', 'day', '2020-02-03', '2020-02-05')
	).toEqual(
		calculateCompletions(applyBaseFilters(notion.tasks), 'UTC', 'day', '2020-02-03', '2020-02-05')
	);
});

test('requests use a redirect mode Cloudflare Workers accept and refuse a redirect reply', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(reply([]))
		.mockResolvedValueOnce(reply([row]));
	await fetchSomaChunk(getSomaConfig(env)!, null, fetcher);
	for (const [, init] of fetcher.mock.calls) expect(init.redirect).toBe('manual');
	const redirected = vi
		.fn()
		.mockResolvedValueOnce(
			new Response(null, { status: 302, headers: { location: 'https://elsewhere.test' } })
		);
	await expect(fetchSomaChunk(getSomaConfig(env)!, null, redirected)).rejects.toThrow(/302/);
});
