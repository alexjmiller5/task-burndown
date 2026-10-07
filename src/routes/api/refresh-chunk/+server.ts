import { fetchLifeChunk, getLifeConfig } from '$lib/server/life-data.js';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNotionApiKey } from '$lib/server/secrets.js';
import { fetchPageChunk } from '$lib/server/notion.js';
import { parseTasks } from '$lib/data/parser.js';

export const POST: RequestHandler = async ({ url, platform }) => {
	const cursor = url.searchParams.get('cursor');
	const config = getLifeConfig(platform!.env);
	if (config) return json(await fetchLifeChunk(config, cursor));
	const chunk = await fetchPageChunk(getNotionApiKey(platform!.env), cursor);
	return json({ ...parseTasks(chunk.pages), nextCursor: chunk.nextCursor });
};
