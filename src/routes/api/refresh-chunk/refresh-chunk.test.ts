import { afterEach, expect, test, vi } from 'vitest';
import { POST } from './+server.ts';

const env = {
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
		}
	}),
	SOMA_HUB_URL: 'https://hub.test',
	SOMA_HUB_TOKEN: 'test-only'
};
// Projects and the first task page arrive in one batched read.
const empty = () =>
	new Response(
		JSON.stringify({
			batch: [
				{ rows: [], next_cursor: null },
				{ rows: [], next_cursor: null }
			]
		})
	);
const event = (platformEnv: object) =>
	({ url: new URL('http://x/api/refresh-chunk'), platform: { env: platformEnv } }) as never;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

test('Soma reads use configured public URL even when a stale Worker binding exists', async () => {
	vi.stubEnv('DEV', false);
	const network = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => empty());
	vi.stubGlobal('fetch', network);
	const hub = { fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => empty()) };
	const response = await POST(event({ ...env, SOMA_HUB: hub }));
	expect(response.status).toBe(200);
	expect(network.mock.calls.map(([url]) => url)).toEqual([
		'https://hub.test/v1/rows/pull',
		'https://hub.test/v1/catalog/projection'
	]);
	expect(hub.fetch).not.toHaveBeenCalled();
	for (const [, init] of network.mock.calls) {
		expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-only' });
		expect(init?.redirect).toBe('manual');
	}
});

test('without a binding (tests, local dev) Soma reads use the network', async () => {
	const network = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => empty());
	vi.stubGlobal('fetch', network);
	expect((await POST(event(env))).status).toBe(200);
	expect(network).toHaveBeenCalledTimes(2);
});

test('the dev server reaches the hub over the network: its platform proxy declares the binding with no hub Worker behind it', async () => {
	vi.stubEnv('DEV', true);
	const network = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => empty());
	vi.stubGlobal('fetch', network);
	const hub = {
		fetch: vi.fn(async () => new Response('Worker "soma" not found', { status: 503 }))
	};
	expect((await POST(event({ ...env, SOMA_HUB: hub }))).status).toBe(200);
	expect(hub.fetch).not.toHaveBeenCalled();
	expect(network).toHaveBeenCalled();
});
