import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNotionApiKey } from '$lib/server/secrets.js';
import { fetchIdChunk } from '$lib/server/notion.js';
import { getPruneCutoff } from '$lib/data/merge.js';

/**
 * One step of the deletion sweep: returns up to ~1,000 live page ids per call,
 * limited to tasks that could plausibly change (see fetchIdChunk). The client
 * computes the cutoff once, passes it on every call, and applies the same
 * heuristic locally when dropping cached tasks missing from the swept ids.
 */
export const POST: RequestHandler = async ({ url, platform }) => {
	const cursor = url.searchParams.get('cursor');
	const cutoff = url.searchParams.get('cutoff') ?? getPruneCutoff();
	const chunk = await fetchIdChunk(getNotionApiKey(platform!.env), cursor, cutoff);
	return json(chunk);
};
