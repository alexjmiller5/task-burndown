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
	history: [],
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
			'Tag & Date History': { rich_text: [] },
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
