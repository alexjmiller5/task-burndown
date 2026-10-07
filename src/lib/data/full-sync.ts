import type { ParsedData, TaskCache } from '$lib/types.js';
import { mergeParsedData } from './merge.js';

/** Preserve the previous cache until every bounded page has succeeded. */
export async function fullSync(fetcher: typeof fetch, progress: () => void): Promise<TaskCache> {
	let merged: ParsedData | null = null;
	let cursor: string | null = null;
	let source: string | undefined;
	const seen = new Set<string>();
	do {
		const qs: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
		const res = await fetcher(`/api/refresh-chunk${qs}`, { method: 'POST' });
		if (!res.ok) throw new Error(`Request failed (${res.status})`);
		const {
			nextCursor,
			deletedIds = [],
			sourceKey,
			...chunk
		} = (await res.json()) as ParsedData & {
			nextCursor: string | null;
			deletedIds?: string[];
			sourceKey?: string;
		};
		if (
			!Array.isArray(chunk.tasks) ||
			!(nextCursor === null || (typeof nextCursor === 'string' && nextCursor))
		)
			throw new Error('Invalid sync page');
		if (merged && sourceKey !== source) throw new Error('Task source changed during sync; retry');
		source = sourceKey;
		merged = merged ? mergeParsedData(merged, chunk) : chunk;
		const deleted = new Set(deletedIds);
		merged.tasks = merged.tasks.filter((t) => !deleted.has(t.id));
		cursor = nextCursor;
		if (cursor && seen.has(cursor)) throw new Error('Repeated sync cursor');
		if (cursor) seen.add(cursor);
		progress();
	} while (cursor);
	const data: TaskCache = { ...merged!, lastFullRefreshAt: new Date().toISOString() };
	const put = await fetcher('/api/cache', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data)
	});
	if (!put.ok) throw new Error(`Cache update failed (${put.status})`);
	return data;
}
