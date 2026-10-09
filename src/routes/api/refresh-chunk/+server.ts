import { fetchSomaChunk, getSomaConfig } from '$lib/server/soma.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNotionApiKey } from '$lib/server/secrets.js';
import { fetchPageChunk } from '$lib/server/notion.js';
import { parseTasks } from '$lib/data/parser.js';

export const POST: RequestHandler = async ({ url, platform }) => {
	const cursor = url.searchParams.get('cursor');
	const config = getSomaConfig(platform!.env);
	if (config) return json(await fetchSomaChunk(config, cursor));
	const chunk = await fetchPageChunk(getNotionApiKey(platform!.env), cursor);
	return json({ ...parseTasks(chunk.pages), nextCursor: chunk.nextCursor });
};
