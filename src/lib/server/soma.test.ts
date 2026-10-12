import { expect, test, vi } from 'vitest';
import { fetchSomaChunk, getSomaConfig, PULL_KEY, refreshSoma } from './soma.js';
import { CACHE_KEY } from './cache.js';

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
// One batched read answers a page per pull asked: [rows, next_cursor] each.
const reply = (...pages: Array<[unknown[], (string | null)?]>) =>
	new Response(
		JSON.stringify({ batch: pages.map(([rows, next_cursor = null]) => ({ rows, next_cursor })) })
	);
const sent = (fetcher: ReturnType<typeof vi.fn>, call: number) =>
	JSON.parse(fetcher.mock.calls[call][1].body).batch;

test('unconfigured stays on Notion; partial and malformed Soma bindings fail closed', () => {
	expect(getSomaConfig({})).toBeNull();
	expect(getSomaConfig({ SOMA_TASKS_CONFIG: 'null' })).toBeNull();
	expect(() => getSomaConfig({ SOMA_TASKS_CONFIG: '{}' })).toThrow();
	expect(() => getSomaConfig({ ...env, SOMA_HUB_TOKEN: '' })).toThrow();
	expect(() =>
		getSomaConfig({ ...env, SOMA_TASKS_CONFIG: JSON.stringify({ ...binding, columns: {} }) })
	).toThrow();
});

test('reads every project and a task page in one batch, keeping original dates, missing completion, tags and source project order', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(
			reply(
				[[{ id: 'p1', label: 'Alpha', deleted_at: null }], 'projects-page2'],
				[[row], 'tasks-page2']
			)
		)
		.mockResolvedValueOnce(reply([[{ id: 'p2', label: 'Beta', deleted_at: null }]]));
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
	expect(fetcher).toHaveBeenCalledTimes(2);
	expect(sent(fetcher, 1)).toMatchObject([{ table: 'initiatives', after: 'projects-page2' }]);
	const [, body] = sent(fetcher, 0);
	expect(body).toMatchObject({ table: 'work', since: '', limit: 4000 });
	expect(body.columns).toContain('deleted_at');
	expect(body.columns).not.toContain('title');
});

test('passes opaque continuation unchanged, preserves timed dates and distinguishes unresolved links from unlinked', async () => {
	const fetcher = vi.fn().mockResolvedValueOnce(
		reply(
			[[]],
			[
				[
					{ ...row, initiatives: '["missing"]', due: '2020-02-03T08:15:00.000Z' },
					{ ...row, id: 't2', initiatives: '[]', ai: 0 },
					{ id: 'removed', deleted_at: '2026-01-01' }
				]
			]
		)
	);
	const result = await fetchSomaChunk(getSomaConfig(env)!, 'opaque+=cursor', fetcher);
	expect(sent(fetcher, 0)[1].after).toBe('opaque+=cursor');
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
		[reply([[], 'repeat'], [[]]), reply([[], 'repeat'])],
		[reply([[]], [[{ ...row, labels: 'not-json' }]])],
		[reply([[]], [[{ ...row, original_created: null }]])],
		[reply([[]], [[]], [[]])],
		[reply([[], 'projects-page2']), new Response('private error', { status: 403 })]
	]) {
		const fetcher = vi.fn();
		for (const response of responses) fetcher.mockResolvedValueOnce(response);
		await expect(fetchSomaChunk(getSomaConfig(env)!, null, fetcher)).rejects.toThrow();
	}
});

test('a project cursor that repeats stops the walk instead of looping', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(reply([[], 'repeat'], [[]]))
		.mockImplementation(async () => reply([[], 'repeat']));
	await expect(fetchSomaChunk(getSomaConfig(env)!, null, fetcher)).rejects.toThrow(
		'Repeated project cursor'
	);
	expect(fetcher).toHaveBeenCalledTimes(2);
});

test('nullable catalog lists and checkbox remain empty rather than becoming invented task facts', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(
			reply(
				[[]],
				[[{ ...row, labels: null, initiatives: null, ai: null, rank: null, state: null }]]
			)
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
		.mockResolvedValueOnce(reply([[{ id: 'p1', label: 'Alpha', deleted_at: null }]], [rows]));
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
	const fetcher = vi.fn().mockResolvedValueOnce(reply([[]], [[row]]));
	await fetchSomaChunk(getSomaConfig(env)!, null, fetcher);
	for (const [, init] of fetcher.mock.calls) expect(init.redirect).toBe('manual');
	const redirected = vi
		.fn()
		.mockResolvedValueOnce(
			new Response(null, { status: 302, headers: { location: 'https://elsewhere.test' } })
		);
	await expect(fetchSomaChunk(getSomaConfig(env)!, null, redirected)).rejects.toThrow(/302/);
});

test('a hub over its byte budget answers the project page alone, and the task page follows', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(reply([[{ id: 'p1', label: 'Alpha', deleted_at: null }]]))
		.mockResolvedValueOnce(reply([[row], 'tasks-page2']));
	const result = await fetchSomaChunk(getSomaConfig(env)!, null, fetcher);
	expect(sent(fetcher, 1)).toMatchObject([{ table: 'work' }]);
	expect(result.tasks[0].projectName).toBe('Alpha');
	expect(result.nextCursor).toBe('tasks-page2');
});

// --- Incremental refresh through the table-pull cursor ---

const T0 = '2026-09-30T00:00:00.000Z';
const T1 = '2026-10-01T00:00:00.000Z';
const T2 = '2026-10-02T00:00:00.000Z';
const config = () => getSomaConfig(env)!;
const live = (id: string, values: Record<string, unknown>, hub_at = T1) => ({
	...row,
	id,
	initiatives: null,
	...values,
	hub_at
});

/** A hub serving `/v1/cursor` and batched `since` pulls over in-memory tables. */
function fakeHub(tables: Record<string, Array<Record<string, unknown>>>, { grant = true } = {}) {
	const calls: Array<{ path: string; body: any }> = [];
	const fetcher = vi.fn(async (url: string, init: RequestInit) => {
		const path = new URL(url).pathname;
		const body = JSON.parse(String(init.body));
		calls.push({ path, body });
		if (path === '/v1/cursor') {
			if (!grant) return new Response('{"error":"insufficient scope"}', { status: 403 });
			const marks: Record<string, string> = {};
			const atMark: Record<string, number> = {};
			for (const t of body.tables as string[]) {
				const rows = tables[t] ?? [];
				marks[t] = rows.reduce<string>((m, r) => (String(r.hub_at) > m ? String(r.hub_at) : m), '');
				if (marks[t]) atMark[t] = rows.filter((r) => r.hub_at === marks[t]).length;
			}
			return Response.json({
				tables: marks,
				at_mark: atMark,
				pull_batch: { items: 50, rows: 5000 }
			});
		}
		return Response.json({
			batch: body.batch.map((item: any) => {
				const rows = (tables[item.table] ?? [])
					.filter((r) => !item.since || String(r.hub_at) >= item.since)
					.filter((r) => !item.after || String(r.id) > item.after)
					.sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
				const page = rows
					.slice(0, item.limit)
					.map((r) => Object.fromEntries(item.columns.map((c: string) => [c, r[c] ?? null])));
				return { rows: page, next_cursor: rows.length > item.limit ? page.at(-1)!.id : null };
			})
		});
	});
	return { calls, fetcher: fetcher as unknown as typeof fetch, tables };
}

/** An R2 bucket whose objects carry a fresh etag per put. */
function fakeBucket() {
	const store = new Map<string, { text: string; etag: string }>();
	const puts: string[] = [];
	let n = 0;
	const object = (key: string) => {
		const v = store.get(key);
		return v ? { etag: v.etag, json: async () => JSON.parse(v.text) } : null;
	};
	return {
		store,
		puts,
		get: async (key: string) => object(key),
		head: async (key: string) => object(key),
		put: async (key: string, text: string) => {
			puts.push(key);
			store.set(key, { text, etag: `e${++n}` });
			return { etag: `e${n}` };
		},
		cache: () => JSON.parse(store.get(CACHE_KEY)!.text)
	};
}
const asBucket = (b: ReturnType<typeof fakeBucket>) => b as unknown as R2Bucket;

function seeded() {
	const hub = fakeHub({
		initiatives: [
			{ id: 'p1', label: 'Alpha', deleted_at: null, hub_at: T1 },
			{ id: 'p2', label: 'Beta', deleted_at: null, hub_at: T0 },
			{ id: 'p3', label: 'Gamma', deleted_at: null, hub_at: T0 }
		],
		work: [
			live('t1', { initiatives: '["p1"]', state: 'To Do' }),
			live('t2', {}),
			live('t4', { initiatives: '["p1"]' }, T0),
			live('t6', { initiatives: '["p3"]' }, T0)
		]
	});
	return { hub, bucket: fakeBucket() };
}

test('a first incremental refresh pulls both tables in one batch and writes the cache and its cursor', async () => {
	const { hub, bucket } = seeded();
	const result = await refreshSoma(config(), asBucket(bucket), hub.fetcher);
	expect(result).toMatchObject({ freshCount: 4 });
	expect(hub.calls.map((c) => c.path)).toEqual(['/v1/cursor', '/v1/rows/pull']);
	expect(hub.calls[1].body.batch.map((b: any) => [b.table, b.since])).toEqual([
		['work', ''],
		['initiatives', '']
	]);
	const cache = bucket.cache();
	expect(cache.tasks.map((t: any) => [t.id, t.projectName])).toEqual([
		['t1', 'Alpha'],
		['t2', '(No Project)'],
		['t4', 'Alpha'],
		['t6', 'Gamma']
	]);
	expect(cache.allProjects).toEqual(['(No Project)', 'Alpha', 'Gamma']);
	expect(cache.lastFullRefreshAt).toMatch(/^\d{4}-\d\d-\d\dT/);
	expect(bucket.puts).toEqual([CACHE_KEY, PULL_KEY]);
});

test('a quiet refresh is one cursor request and writes nothing', async () => {
	const { hub, bucket } = seeded();
	await refreshSoma(config(), asBucket(bucket), hub.fetcher);
	hub.calls.length = 0;
	bucket.puts.length = 0;
	expect(await refreshSoma(config(), asBucket(bucket), hub.fetcher)).toMatchObject({
		freshCount: 0
	});
	expect(hub.calls.map((c) => c.path)).toEqual(['/v1/cursor']);
	expect(bucket.puts).toEqual([]);
});

test('later refreshes apply only arrivals: edits, new rows, tombstones and project renames', async () => {
	const { hub, bucket } = seeded();
	await refreshSoma(config(), asBucket(bucket), hub.fetcher);
	const { lastFullRefreshAt } = bucket.cache();
	hub.tables.initiatives = [
		{ id: 'p1', label: 'Renamed', deleted_at: null, hub_at: T2 },
		{ id: 'p2', label: 'Beta', deleted_at: null, hub_at: T0 },
		{ id: 'p3', label: 'Gamma', deleted_at: T2, hub_at: T2 }
	];
	hub.tables.work = [
		live('t1', { initiatives: '["p1"]', state: 'In Progress' }, T2),
		live('t2', { deleted_at: T2 }, T2),
		live('t3', { initiatives: '["p2"]' }, T2),
		// Untouched: only the project changes can relabel them.
		live('t4', { initiatives: '["p1"]' }, T0),
		live('t6', { initiatives: '["p3"]' }, T0)
	];
	hub.calls.length = 0;
	const result = await refreshSoma(config(), asBucket(bucket), hub.fetcher);
	expect(result).toEqual({ freshCount: 3 });

	expect(hub.calls[1].body.batch.map((b: any) => [b.table, b.since])).toEqual([
		['work', T1],
		['initiatives', T1]
	]);
	const cache = bucket.cache();
	expect(cache.tasks.map((t: any) => [t.id, t.status, t.projectName])).toEqual([
		['t1', 'In Progress', 'Renamed'],
		['t4', 'Completed', 'Renamed'],
		['t6', 'Completed', '(Unavailable Project)'],
		['t3', 'Completed', 'Beta']
	]);
	expect(cache.allProjects).toEqual(['(Unavailable Project)', 'Beta', 'Renamed']);
	expect(cache.lastFullRefreshAt).toBe(lastFullRefreshAt);
});

test('a cache replaced outside the cursor, a changed binding or full: true re-read everything', async () => {
	const { hub, bucket } = seeded();
	await refreshSoma(config(), asBucket(bucket), hub.fetcher);
	const fullPull = () => hub.calls[1]?.body.batch.map((b: any) => b.since);

	await bucket.put(CACHE_KEY, JSON.stringify({ ...bucket.cache(), tasks: [] }));
	hub.calls.length = 0;
	await refreshSoma(config(), asBucket(bucket), hub.fetcher);
	expect(fullPull()).toEqual(['', '']);
	expect(bucket.cache().tasks).toHaveLength(4);

	hub.calls.length = 0;
	const recolored = { ...env, SOMA_TASKS_CONFIG: JSON.stringify({ ...binding, tagColors: {} }) };
	await refreshSoma(getSomaConfig(recolored)!, asBucket(bucket), hub.fetcher);
	expect(fullPull()).toEqual(['', '']);

	hub.calls.length = 0;
	await refreshSoma(getSomaConfig(recolored)!, asBucket(bucket), hub.fetcher, { full: true });
	expect(fullPull()).toEqual(['', '']);
});

test('without the hub_at grant the cursor is refused, nothing is written, and the caller falls back', async () => {
	const hub = fakeHub({ work: [live('t1', {})] }, { grant: false });
	const bucket = fakeBucket();
	expect(await refreshSoma(config(), asBucket(bucket), hub.fetcher)).toBeNull();
	expect(hub.calls.map((c) => c.path)).toEqual(['/v1/cursor']);
	expect(bucket.puts).toEqual([]);
});

test('incremental requests refuse redirects like the batched read', async () => {
	const { hub, bucket } = seeded();
	await refreshSoma(config(), asBucket(bucket), hub.fetcher);
	const init = (hub.fetcher as any).mock.calls[0][1] as RequestInit;
	expect(init.redirect).toBe('manual');
	const redirected = vi.fn(async () => new Response(null, { status: 302 }));
	await expect(
		refreshSoma(config(), asBucket(fakeBucket()), redirected as unknown as typeof fetch)
	).rejects.toThrow('302');
});
