import { fetchSomaChunk, getSomaConfig } from '$lib/server/soma.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNotionApiKey } from '$lib/server/secrets.js';
import { fetchPageChunk } from '$lib/server/notion.js';
import { parseTasks } from '$lib/data/parser.js';

export const POST: RequestHandler = async ({ url, platform }) => {
	const cursor = url.searchParams.get('cursor');
	const config = getSomaConfig(platform!.env);
	// A Worker cannot fetch a sibling workers.dev Worker (Cloudflare error 1042):
	// reach the hub through its service binding. Call it as a method; a detached
	// binding fetch throws Illegal invocation.
	const hub = platform!.env.SOMA_HUB;
	const fetcher = hub ? (((input, init) => hub.fetch(input, init)) as typeof fetch) : fetch;
	if (config) return json(await fetchSomaChunk(config, cursor, fetcher));
	const chunk = await fetchPageChunk(getNotionApiKey(platform!.env), cursor);
	return json({ ...parseTasks(chunk.pages), nextCursor: chunk.nextCursor });
};
