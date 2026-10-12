import { afterEach, expect, test, vi } from 'vitest';
import { POST } from './+server.ts';
import { CACHE_KEY, EMPTY_CACHE } from '$lib/server/cache.js';

function fakeBucket(initial?: string) {
	const store = new Map<string, string>();
	if (initial !== undefined) store.set(CACHE_KEY, initial);
	return {
		store,
		async get(key: string) {
			const v = store.get(key);
			return v === undefined ? null : { json: async () => JSON.parse(v) };
		},
		async put(key: string, value: string) {
			store.set(key, value);
		}
	};
}
function makeEvent(bucket: ReturnType<typeof fakeBucket>, search = '') {
	return {
		url: new URL(`http://x/api/refresh${search}`),
		platform: { env: { CACHE: bucket, NOTION_API_KEY: 'k' } }
	} as never;
}
const task = {
	id: 't1',
	created: '2026-07-01T00:00:00.000Z',
	completed: null,
	dueDate: null,
	status: 'Not started',
	tags: [],
	priority: '(No Priority)',
	projectName: '(No Project)',
	aiCompleted: false,
	hasProject: false,
	lastEditedTime: '2026-07-02T00:00:00.000Z'
};

afterEach(() => vi.unstubAllGlobals());

test('empty cache -> needsFull, no Notion call', async () => {
	const fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	const res = await POST(makeEvent(fakeBucket()));
	expect(await res.json()).toEqual({ needsFull: true });
	expect(fetchMock.mock.calls.length).toEqual(0);
});

test('syncs from the cache high-water mark (earlier of max created/edited)', async () => {
	const cache = { ...EMPTY_CACHE, tasks: [task], lastFullRefreshAt: '2020-01-01T00:00:00.000Z' };
	const fetchMock = vi.fn().mockResolvedValue(
		new Response(JSON.stringify({ results: [], has_more: false, next_cursor: null }), {
			status: 200
		})
	);
	vi.stubGlobal('fetch', fetchMock);
	await POST(makeEvent(fakeBucket(JSON.stringify(cache))));
	const body = JSON.parse(fetchMock.mock.calls[0][1].body);
	// earlier of max(created)=07-01 and max(edited)=07-02
	expect(body.filter.last_edited_time.on_or_after).toEqual('2026-07-01T00:00:00.000Z');
});

test('incremental merge, cache written', async () => {
	const cache = { ...EMPTY_CACHE, tasks: [task], lastFullRefreshAt: '2026-07-08T00:00:00.000Z' };
	const bucket = fakeBucket(JSON.stringify(cache));
	const freshPage = {
		id: 't2',
		created_time: '2026-07-08T01:00:00.000Z',
		last_edited_time: '2026-07-08T01:00:00.000Z',
		archived: false,
		in_trash: false,
		url: '',
		properties: {
			'Date Created': { created_time: '2026-07-08T01:00:00.000Z' },
			'Completed Date': { date: null },
			'Due Date': { date: null },
			Status: { status: { name: 'Not started' } },
			Tags: { multi_select: [] },
			Priority: { select: null },
			'Project Title': { rollup: { array: [] } }
		}
	};
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ results: [freshPage], has_more: false, next_cursor: null }), {
				status: 200
			})
		)
	);
	const res = await POST(makeEvent(bucket));
	const body = (await res.json()) as { needsFull: boolean; freshCount: number };
	expect(body.needsFull).toEqual(false);
	expect(body.freshCount).toEqual(1);
	const written = JSON.parse(bucket.store.get(CACHE_KEY)!);
	expect(written.tasks.length).toEqual(2);
	expect(written.lastFullRefreshAt).toEqual('2026-07-08T00:00:00.000Z'); // unchanged by incremental
});

// --- Soma source: incremental through the table-pull cursor ---

const somaEnv = {
	SOMA_TASKS_CONFIG: JSON.stringify({
		table: 'tasks',
		projects: { table: 'projects', title: 'title' },
		columns: {
			created: 'created_at',
			completed: 'completed_date',
			dueDate: 'due_date',
			status: 'status',
			tags: 'tags',
			priority: 'priority',
			projectIds: 'project_ids',
			aiCompleted: 'ai_completed'
		},
		tagColors: {}
	}),
	SOMA_HUB_URL: 'https://hub.test',
	SOMA_HUB_TOKEN: 'test-only'
};
function somaBucket() {
	const store = new Map<string, { value: string; etag: string }>();
	let n = 0;
	const object = (key: string) => {
		const v = store.get(key);
		return v ? { etag: v.etag, json: async () => JSON.parse(v.value) } : null;
	};
	return {
		get: async (key: string) => object(key),
		head: async (key: string) => object(key),
		put: async (key: string, value: string) => {
			store.set(key, { value, etag: `e${++n}` });
			return { etag: `e${n}` };
		}
	};
}
const hubReply = (grant: boolean) =>
	vi.fn(async (url: string, init: RequestInit) => {
		const path = new URL(url).pathname;
		if (path === '/v1/cursor')
			return grant
				? Response.json({
						tables: { tasks: '', projects: '' },
						at_mark: {},
						pull_batch: { items: 50, rows: 5000 }
					})
				: new Response('{"error":"insufficient scope"}', { status: 403 });
		const { batch } = JSON.parse(String(init.body));
		return Response.json({ batch: batch.map(() => ({ rows: [], next_cursor: null })) });
	});
const somaEvent = (platformEnv: object, search = '') =>
	({
		url: new URL(`http://x/api/refresh${search}`),
		platform: { env: { CACHE: somaBucket(), ...somaEnv, ...platformEnv } }
	}) as never;

test('Soma refreshes incrementally through the hub binding and reports deletions as applied', async () => {
	const network = vi.fn();
	vi.stubGlobal('fetch', network);
	const hub = { fetch: hubReply(true) };
	const body = await (await POST(somaEvent({ SOMA_HUB: hub }))).json();
	expect(body).toMatchObject({ needsFull: false, freshCount: 0, pruned: true });
	expect(hub.fetch.mock.calls.map((c) => new URL(c[0]).pathname)).toEqual([
		'/v1/cursor',
		'/v1/rows/pull'
	]);
	expect(network).not.toHaveBeenCalled();
});

test('?full=1 re-reads every Soma row even with a held cursor', async () => {
	const hub = { fetch: hubReply(true) };
	const bucket = somaBucket();
	const event = (search = '') =>
		({
			url: new URL(`http://x/api/refresh${search}`),
			platform: { env: { CACHE: bucket, ...somaEnv, SOMA_HUB: hub } }
		}) as never;
	await POST(event());
	hub.fetch.mockClear();
	await POST(event());
	expect(hub.fetch).toHaveBeenCalledTimes(1);
	hub.fetch.mockClear();
	await POST(event('?full=1'));
	expect(hub.fetch).toHaveBeenCalledTimes(2);
});

test('without the hub_at grant Soma asks the client for the chunked full read', async () => {
	vi.stubGlobal('fetch', hubReply(false));
	const body = await (await POST(somaEvent({}))).json();
	expect(body).toEqual({ needsFull: true });
});
