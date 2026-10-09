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
		},
		tagColors: {}
	}),
	SOMA_HUB_URL: 'https://hub.test',
	SOMA_HUB_TOKEN: 'test-only'
};
const empty = () => new Response(JSON.stringify({ rows: [], next_cursor: null }));
const event = (platformEnv: object) =>
	({ url: new URL('http://x/api/refresh-chunk'), platform: { env: platformEnv } }) as never;

afterEach(() => vi.unstubAllGlobals());

test('Soma reads go through the hub service binding when the Worker has one', async () => {
	const network = vi.fn();
	vi.stubGlobal('fetch', network);
	const hub = { fetch: vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => empty()) };
	const response = await POST(event({ ...env, SOMA_HUB: hub }));
	expect(response.status).toBe(200);
	expect(hub.fetch).toHaveBeenCalledTimes(2);
	expect(hub.fetch.mock.calls[0][0]).toBe('https://hub.test/v1/rows/pull');
	expect(network).not.toHaveBeenCalled();
});

test('without a binding (tests, local dev) Soma reads use the network', async () => {
	const network = vi.fn(async () => empty());
	vi.stubGlobal('fetch', network);
	expect((await POST(event(env))).status).toBe(200);
	expect(network).toHaveBeenCalledTimes(2);
});
