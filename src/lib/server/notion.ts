import type { NotionPage } from '$lib/types.js';

const DATA_SOURCE_ID = '77ef5074-aa23-468a-b5fb-2692e78184db';
const QUERY_URL = `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`;
const API_VERSION = '2026-03-11';

function apiHeaders(apiKey: string): Record<string, string> {
	return {
		Authorization: `Bearer ${apiKey}`,
		'Content-Type': 'application/json',
		'Notion-Version': API_VERSION
	};
}

async function fetchPaginated(
	apiKey: string,
	payload: Record<string, unknown> = {}
): Promise<NotionPage[]> {
	const allPages: NotionPage[] = [];
	let hasMore = true;
	let startCursor: string | undefined;

	while (hasMore) {
		const body: Record<string, unknown> = { ...payload };
		if (startCursor) body.start_cursor = startCursor;

		const response = await fetch(QUERY_URL, {
			method: 'POST',
			headers: apiHeaders(apiKey),
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Notion API error ${response.status}: ${text}`);
		}

		const data = (await response.json()) as {
			results: NotionPage[];
			has_more?: boolean;
			next_cursor?: string | null;
		};
		allPages.push(...data.results);
		hasMore = data.has_more ?? false;
		startCursor = data.next_cursor ?? undefined;
	}

	return allPages;
}

export async function fetchAllPages(apiKey: string): Promise<NotionPage[]> {
	return fetchPaginated(apiKey);
}

export async function fetchIncrementalPages(apiKey: string, since: string): Promise<NotionPage[]> {
	return fetchPaginated(apiKey, {
		filter: {
			property: 'Last edited time',
			last_edited_time: {
				on_or_after: since
			}
		}
	});
}

export interface PageChunk {
	pages: NotionPage[];
	nextCursor: string | null;
}

async function fetchChunk(
	apiKey: string,
	url: string,
	cursor: string | null,
	maxRequests: number,
	filter?: Record<string, unknown>
): Promise<PageChunk> {
	const pages: NotionPage[] = [];
	let startCursor = cursor ?? undefined;
	for (let i = 0; i < maxRequests; i++) {
		const body: Record<string, unknown> = {};
		if (filter) body.filter = filter;
		if (startCursor) body.start_cursor = startCursor;
		const response = await fetch(url, {
			method: 'POST',
			headers: apiHeaders(apiKey),
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			throw new Error(`Notion API error ${response.status}: ${await response.text()}`);
		}
		const data = (await response.json()) as {
			results: NotionPage[];
			has_more?: boolean;
			next_cursor?: string | null;
		};
		pages.push(...data.results);
		startCursor = data.next_cursor ?? undefined;
		if (!(data.has_more ?? false)) return { pages, nextCursor: null };
	}
	return { pages, nextCursor: startCursor ?? null };
}

/**
 * Fetch up to maxRequests pagination steps of the full-database query.
 * ponytail: 3 requests/chunk keeps each Worker invocation ~4-6ms CPU and 3
 * subrequests — the client loops with nextCursor until null.
 */
export async function fetchPageChunk(
	apiKey: string,
	cursor: string | null,
	maxRequests = 3
): Promise<PageChunk> {
	return fetchChunk(apiKey, QUERY_URL, cursor, maxRequests);
}

export interface IdChunk {
	ids: string[];
	nextCursor: string | null;
}

/**
 * Fetch page ids only, for the deletion sweep. filter_properties[]=title keeps
 * each response ~50 KB, so 10 API pages per invocation stays well under the
 * 10 ms CPU cap while covering ~1,000 tasks per client call. The filter limits
 * the sweep to tasks that could plausibly change: created/edited since the
 * cutoff, or still open — settled old tasks are assumed immutable.
 */
export async function fetchIdChunk(
	apiKey: string,
	cursor: string | null,
	cutoff: string,
	maxRequests = 10
): Promise<IdChunk> {
	const filter = {
		or: [
			{ timestamp: 'created_time', created_time: { on_or_after: cutoff } },
			{ timestamp: 'last_edited_time', last_edited_time: { on_or_after: cutoff } },
			{ property: 'Status', status: { equals: 'To Do' } },
			{ property: 'Status', status: { equals: 'In Progress' } }
		]
	};
	const { pages, nextCursor } = await fetchChunk(
		apiKey,
		`${QUERY_URL}?filter_properties[]=title`,
		cursor,
		maxRequests,
		filter
	);
	return { ids: pages.map((p) => p.id), nextCursor };
}
