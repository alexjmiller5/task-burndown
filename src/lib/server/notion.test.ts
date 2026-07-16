import { afterEach, expect, test, vi } from 'vitest';
import { fetchIdChunk, fetchPageChunk } from './notion.ts';

function notionResponse(ids: string[], nextCursor: string | null) {
	return new Response(
		JSON.stringify({
			results: ids.map((id) => ({
				id,
				created_time: '',
				last_edited_time: '',
				properties: {},
				archived: false,
				in_trash: false,
				url: ''
			})),
			has_more: nextCursor !== null,
			next_cursor: nextCursor
		}),
		{ status: 200 }
	);
}

afterEach(() => vi.unstubAllGlobals());

test('fetchPageChunk stops after maxRequests and returns the cursor', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(notionResponse(['a'], 'c1'))
		.mockResolvedValueOnce(notionResponse(['b'], 'c2'))
		.mockResolvedValueOnce(notionResponse(['c'], 'c3'));
	vi.stubGlobal('fetch', fetchMock);
	const chunk = await fetchPageChunk('key', null, 3);
	expect(fetchMock.mock.calls.length).toEqual(3);
	expect(chunk.pages.map((p) => p.id)).toEqual(['a', 'b', 'c']);
	expect(chunk.nextCursor).toEqual('c3');
});

test('fetchPageChunk returns null cursor when Notion is exhausted early', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(notionResponse(['a'], null)));
	const chunk = await fetchPageChunk('key', null, 3);
	expect(chunk.pages.map((p) => p.id)).toEqual(['a']);
	expect(chunk.nextCursor).toEqual(null);
});

test('fetchPageChunk resumes from a given cursor', async () => {
	const fetchMock = vi.fn().mockResolvedValueOnce(notionResponse(['z'], null));
	vi.stubGlobal('fetch', fetchMock);
	await fetchPageChunk('key', 'resume-me', 3);
	const body = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(body.start_cursor).toEqual('resume-me');
});

const CUTOFF = '2026-04-01T00:00:00.000Z';

test('fetchIdChunk returns ids and requests a slim payload', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(notionResponse(['a', 'b'], 'c1'))
		.mockResolvedValueOnce(notionResponse(['c'], null));
	vi.stubGlobal('fetch', fetchMock);
	const chunk = await fetchIdChunk('key', null, CUTOFF, 10);
	expect(chunk.ids).toEqual(['a', 'b', 'c']);
	expect(chunk.nextCursor).toEqual(null);
	expect(fetchMock.mock.calls[0][0]).toContain('filter_properties');
});

test('fetchIdChunk filters to recently created/edited or open tasks', async () => {
	const fetchMock = vi.fn().mockResolvedValueOnce(notionResponse(['a'], null));
	vi.stubGlobal('fetch', fetchMock);
	await fetchIdChunk('key', null, CUTOFF, 10);
	const body = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(body.filter.or).toEqual([
		{ timestamp: 'created_time', created_time: { on_or_after: CUTOFF } },
		{ timestamp: 'last_edited_time', last_edited_time: { on_or_after: CUTOFF } },
		{ property: 'Status', status: { equals: 'To Do' } },
		{ property: 'Status', status: { equals: 'In Progress' } }
	]);
});

test('fetchIdChunk stops after maxRequests and returns the cursor', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(notionResponse(['a'], 'c1'))
		.mockResolvedValueOnce(notionResponse(['b'], 'c2'));
	vi.stubGlobal('fetch', fetchMock);
	const chunk = await fetchIdChunk('key', null, CUTOFF, 2);
	expect(chunk.ids).toEqual(['a', 'b']);
	expect(chunk.nextCursor).toEqual('c2');
});
