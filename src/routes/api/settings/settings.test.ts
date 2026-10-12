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
function event(bucket: ReturnType<typeof fakeBucket>, body?: string) {
	return {
		request: new Request('http://x/api/settings', { method: 'PUT', body }),
		platform: { env: { CACHE: bucket } }
	} as never;
}

test('no stored settings -> the default day start', async () => {
	const res = await GET(event(fakeBucket()));
	expect(await res.json()).toEqual({ dayStartMinutes: 0 });
});

test('PUT stores validated settings that GET returns', async () => {
	const bucket = fakeBucket();
	const put = await PUT(event(bucket, JSON.stringify({ dayStartMinutes: 180 })));
	expect(put.status).toBe(200);
	expect([...bucket.store.keys()]).toEqual(['settings.json']);
	expect(await (await GET(event(bucket))).json()).toEqual({ dayStartMinutes: 180 });
});

test.each([JSON.stringify({ dayStartMinutes: 1440 }), '{not json'])(
	'PUT rejects %s and keeps the stored settings',
	async (body) => {
		const bucket = fakeBucket();
		await PUT(event(bucket, JSON.stringify({ dayStartMinutes: 180 })));
		const bad = await PUT(event(bucket, body));
		expect(bad.status).toBe(400);
		expect(await (await GET(event(bucket))).json()).toEqual({ dayStartMinutes: 180 });
	}
);
