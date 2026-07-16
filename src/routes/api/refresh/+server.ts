import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNotionApiKey } from '$lib/server/secrets.js';
import { readCache, writeCache } from '$lib/server/cache.js';
import { fetchIncrementalPages } from '$lib/server/notion.js';
import { parseTasks } from '$lib/data/parser.js';
import { getIncrementalSince, mergeParsedData } from '$lib/data/merge.js';

export const POST: RequestHandler = async ({ platform }) => {
	const env = platform!.env;
	const cache = await readCache(env.CACHE);

	// Empty cache bootstraps via the client's chunked full-sync loop.
	if (cache.tasks.length === 0) return json({ needsFull: true });

	// Always sync from the cache's own high-water mark so edits made on days
	// the app wasn't opened are never skipped. Deletions are the /api/prune
	// sweep's job — edits and creations all bump last_edited_time.
	const since = getIncrementalSince(cache.tasks)!;
	const fresh = await fetchIncrementalPages(getNotionApiKey(env), since);
	const merged = mergeParsedData(cache, parseTasks(fresh));
	const data = { ...merged, lastFullRefreshAt: cache.lastFullRefreshAt };
	await writeCache(env.CACHE, data);
	return json({
		needsFull: false,
		freshCount: fresh.length,
		lastFullRefreshAt: data.lastFullRefreshAt
	});
};
