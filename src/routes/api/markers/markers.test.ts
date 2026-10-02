import { expect, test } from 'vitest';
import { GET, PUT } from './+server.ts';

function fakeBucket() {
	const store = new Map<string, string>();
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
function event(bucket: ReturnType<typeof fakeBucket>, body?: unknown) {
	return {
		request: new Request('http://x/api/markers', { method: 'PUT', body: JSON.stringify(body) }),
		platform: { env: { CACHE: bucket } }
	} as never;
}
const marker = { date: '2026-09-12', label: 'Sweep', direction: 'down' };

test('no stored markers -> empty list', async () => {
	const res = await GET(event(fakeBucket()));
	expect(await res.json()).toEqual([]);
});

test('PUT stores a validated list that GET returns', async () => {
	const bucket = fakeBucket();
	const put = await PUT(event(bucket, [marker]));
	expect(put.status).toBe(200);
	expect(await (await GET(event(bucket))).json()).toEqual([marker]);
});

test('PUT rejects an invalid list and keeps the stored one', async () => {
	const bucket = fakeBucket();
	await PUT(event(bucket, [marker]));
	const bad = await PUT(event(bucket, [{ ...marker, direction: 'sideways' }]));
	expect(bad.status).toBe(400);
	expect(await (await GET(event(bucket))).json()).toEqual([marker]);
});
