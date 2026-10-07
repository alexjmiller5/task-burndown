import { expect, test, vi } from 'vitest';
import { fullSync } from './full-sync.js';
const chunk = (ids: string[], nextCursor: string | null, extra = {}) => ({
	tasks: ids.map((id) => ({ id })),
	allTags: [],
	allPriorities: [],
	allProjects: [],
	tagColors: {},
	nextCursor,
	...extra
});
const reply = (body: unknown) => new Response(JSON.stringify(body));

test('publishes once only after complete scan and applies later tombstones', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(reply(chunk(['a', 'b'], 'opaque')))
		.mockResolvedValueOnce(reply(chunk(['c'], null, { deletedIds: ['a'] })))
		.mockResolvedValueOnce(new Response());
	const result = await fullSync(fetcher, () => {});
	expect(result.tasks.map((t) => t.id)).toEqual(['b', 'c']);
	expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
		'/api/refresh-chunk',
		'/api/refresh-chunk?cursor=opaque',
		'/api/cache'
	]);
	expect(JSON.parse(fetcher.mock.calls[2][1].body).tasks.map((t: { id: string }) => t.id)).toEqual([
		'b',
		'c'
	]);
});

test('failed middle page never replaces old cache', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(reply(chunk(['a'], 'second')))
		.mockResolvedValueOnce(new Response('', { status: 503 }));
	await expect(fullSync(fetcher, () => {})).rejects.toThrow('503');
	expect(fetcher.mock.calls).toHaveLength(2);
});

test('repeated cursor and changing source binding abort without publishing', async () => {
	for (const pages of [
		[chunk([], 'again'), chunk([], 'again')],
		[chunk([], 'second', { sourceKey: 'a' }), chunk([], null, { sourceKey: 'b' })]
	]) {
		const fetcher = vi.fn();
		for (const page of pages) fetcher.mockResolvedValueOnce(reply(page));
		await expect(fullSync(fetcher, () => {})).rejects.toThrow();
		expect(fetcher.mock.calls.every((c) => c[0] !== '/api/cache')).toBe(true);
	}
});
