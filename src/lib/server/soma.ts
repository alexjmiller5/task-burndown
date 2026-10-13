import type { ParsedData, Task, TaskCache } from '$lib/types.js';
import { PRIORITY_ORDER } from '$lib/data/parser.js';
import { CACHE_KEY } from './cache.js';
import { pullTables, type PullState } from './table-pull.js';

export type SomaEnv = {
	SOMA_TASKS_CONFIG?: string;
	SOMA_HUB_URL?: string;
	SOMA_HUB_TOKEN?: string;
	SOMA_HUB?: { fetch: typeof fetch };
};
type Field =
	| 'created'
	| 'completed'
	| 'dueDate'
	| 'status'
	| 'tags'
	| 'priority'
	| 'projectIds'
	| 'aiCompleted';
type Binding = {
	table: string;
	projects: { table: string; title: string };
	columns: Record<Field, string>;
};
type Config = { binding: Binding; url: string; token: string };
const fields: Field[] = [
	'created',
	'completed',
	'dueDate',
	'status',
	'tags',
	'priority',
	'projectIds',
	'aiCompleted'
];
const identifier = (value: unknown): value is string =>
	typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);

export function getSomaConfig(env: SomaEnv): Config | null {
	const local = (globalThis as { process?: { env?: SomaEnv } }).process?.env;
	const raw = env.SOMA_TASKS_CONFIG ?? local?.SOMA_TASKS_CONFIG;
	if (!raw) return null;
	const binding = JSON.parse(raw) as Binding | null;
	if (binding === null) return null;
	if (
		!binding ||
		!identifier(binding.table) ||
		!identifier(binding.projects?.table) ||
		!identifier(binding.projects?.title) ||
		fields.some((f) => !identifier(binding.columns?.[f]))
	)
		throw new Error('Invalid SOMA_TASKS_CONFIG mapping');
	const url = env.SOMA_HUB_URL ?? local?.SOMA_HUB_URL;
	const token = env.SOMA_HUB_TOKEN ?? local?.SOMA_HUB_TOKEN;
	if (!url || !token) throw new Error('Soma URL and dedicated read credential are required');
	const endpoint = new URL(url);
	if (
		endpoint.protocol !== 'https:' ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash
	)
		throw new Error('Invalid Soma URL');
	return { binding, url: url.replace(/\/$/, ''), token };
}

/**
 * A Worker cannot fetch a sibling workers.dev Worker (Cloudflare error 1042):
 * reach the hub through its service binding when there is one. Call it as a
 * method; a detached binding fetch throws Illegal invocation. The dev server's
 * platform proxy declares the binding with no hub Worker behind it, so dev
 * uses the network.
 */
export function hubFetch(env: SomaEnv): typeof fetch {
	const hub = import.meta.env.DEV ? undefined : env.SOMA_HUB;
	return hub ? (((input, init) => hub.fetch(input, init)) as typeof fetch) : fetch;
}

type Row = Record<string, unknown>;
function text(value: unknown): string {
	if (typeof value !== 'string' || !value) throw new Error('Missing or invalid task text');
	return value;
}
function optionalText(value: unknown): string | null {
	return value === null ? null : text(value);
}
function array(value: unknown): string[] {
	const parsed = value === null ? [] : typeof value === 'string' ? JSON.parse(value) : value;
	if (!Array.isArray(parsed) || parsed.some((v) => typeof v !== 'string'))
		throw new Error('Invalid task list');
	return parsed;
}

type Page = { rows: Row[]; next_cursor: string | null };
type Pull = { table: string; columns: string[]; limit: number; cursor: string | null };
// One batched read: the hub caps a batch at 5,000 rows, and every project plus a
// large task page fit in one request.
const PROJECTS = 1000;
const TASKS = 4000;

async function pull(config: Config, pulls: Pull[], fetcher: typeof fetch): Promise<Page[]> {
	const response = await fetcher(`${config.url}/v1/rows/pull`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			batch: pulls.map(({ table, columns, limit, cursor }) => ({
				table,
				columns: [...new Set(['id', 'updated_at', 'deleted_at', ...columns])],
				since: '',
				limit,
				...(cursor ? { after: cursor } : {})
			}))
		}),
		signal: AbortSignal.timeout(20000),
		// Workers reject 'error'; a manual redirect is not ok and fails below.
		redirect: 'manual'
	});
	if (!response.ok) throw new Error(`Soma read failed (${response.status})`);
	const body = (await response.json()) as { batch: Page[] };
	// Past its byte budget the hub answers a prefix of the pulls asked.
	if (
		!Array.isArray(body.batch) ||
		!body.batch.length ||
		body.batch.length > pulls.length ||
		body.batch.some(
			(page) =>
				!Array.isArray(page?.rows) ||
				!(page.next_cursor === null || (typeof page.next_cursor === 'string' && page.next_cursor))
		)
	)
		throw new Error('Invalid Soma page receipt');
	return body.batch;
}

/** A current paginated scan, not an immutable snapshot or backup. */
export async function fetchSomaChunk(
	config: Config,
	cursor: string | null,
	fetcher: typeof fetch = fetch
): Promise<ParsedData & { nextCursor: string | null; deletedIds: string[]; sourceKey: string }> {
	const { binding } = config;
	const projectPull = (after: string | null): Pull => ({
		table: binding.projects.table,
		columns: [binding.projects.title],
		limit: PROJECTS,
		cursor: after
	});
	const taskPull: Pull = {
		table: binding.table,
		columns: Object.values(binding.columns),
		limit: TASKS,
		cursor
	};
	const projects = new Map<string, string>();
	const seen = new Set<string>();
	let [projectPage, result] = await pull(config, [projectPull(null), taskPull], fetcher);
	for (;;) {
		for (const row of projectPage.rows) {
			const id = text(row.id);
			if (row.deleted_at) projects.delete(id);
			else projects.set(id, text(row[binding.projects.title]));
		}
		const after = projectPage.next_cursor;
		if (!after) break;
		if (seen.has(after)) throw new Error('Repeated project cursor');
		seen.add(after);
		[projectPage] = await pull(config, [projectPull(after)], fetcher);
	}
	result ??= (await pull(config, [taskPull], fetcher))[0];
	const tasks: Task[] = [];
	const deletedIds: string[] = [];
	for (const row of result.rows) {
		if (row.deleted_at) deletedIds.push(text(row.id));
		else tasks.push(toTask(row, binding, projects));
	}
	return {
		...summarize(tasks, await fetchTagColors(config, fetcher)),
		deletedIds,
		nextCursor: result.next_cursor,
		sourceKey: await sourceKeyOf(config)
	};
}

function toTask(row: Row, binding: Binding, projects: Map<string, string>): Task {
	const c = binding.columns;
	const ids = array(row[c.projectIds]);
	const ai = row[c.aiCompleted] === null ? false : row[c.aiCompleted];
	if (![true, false, 0, 1].includes(ai as boolean | number))
		throw new Error('Invalid task checkbox');
	return {
		id: text(row.id),
		created: text(row[c.created]),
		completed: optionalText(row[c.completed]),
		dueDate: optionalText(row[c.dueDate]),
		status: optionalText(row[c.status]) ?? '',
		tags: array(row[c.tags]),
		priority: optionalText(row[c.priority]) || '(No Priority)',
		projectName: projectName(ids[0], projects),
		hasProject: ids.length > 0,
		aiCompleted: ai === true || ai === 1,
		lastEditedTime: text(row.updated_at)
	};
}

const projectName = (id: string | undefined, projects: Map<string, string>) =>
	id === undefined ? '(No Project)' : (projects.get(id) ?? '(Unavailable Project)');

function summarize(tasks: Task[], tagColors: Record<string, string>): ParsedData {
	return {
		tasks,
		allTags: [...new Set(['(Untagged)', ...tasks.flatMap((t) => t.tags)])].sort(),
		allPriorities: PRIORITY_ORDER.filter((p) => tasks.some((t) => t.priority === p)),
		allProjects: [...new Set(tasks.map((t) => t.projectName))].sort(),
		tagColors: { ...tagColors, '(Untagged)': 'default' }
	};
}

/**
 * Tag colors are the catalog's own option colors for the tags column (palette
 * names, as Iris renders them), read through the hub's column-authorized
 * metadata route: it needs `catalog:read:<table>:<tags column>` beside the
 * column read. Without it, or on any failure, the sync still lands and tags
 * take the chart's fallback colors.
 */
async function fetchTagColors(config: Config, fetcher: typeof fetch) {
	const { table, columns } = config.binding;
	try {
		const response = await fetcher(`${config.url}/v1/catalog/projection`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ table, columns: [columns.tags] }),
			signal: AbortSignal.timeout(20000),
			redirect: 'manual'
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const body = (await response.json()) as {
			properties: Array<{ options?: Array<{ v: unknown; color?: unknown }> }>;
		};
		return Object.fromEntries(
			(body.properties[0].options ?? []).flatMap(({ v, color }) =>
				typeof v === 'string' && typeof color === 'string' ? [[v, color]] : []
			)
		) as Record<string, string>;
	} catch (error) {
		console.warn(
			`Soma tag colors unavailable (${(error as Error).message}); using fallback colors`
		);
		return {};
	}
}

/** Identifies the hub and mapping a cache was built from. */
async function sourceKeyOf(config: Config): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify([config.url, config.binding]))
	);
	return Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join('');
}

export const PULL_KEY = 'soma-pull.json';

/**
 * The table-pull cursor for the cache object it was applied to (`cache` is
 * that object's etag), plus project labels and each task's first project ref
 * (so a rename relabels its tasks). Anything else replacing the cache (a
 * chunked full sync, a reseed) invalidates it, so the next refresh re-reads
 * everything instead of patching a cache it never saw.
 */
type PullFile = {
	sourceKey: string;
	cache: string;
	state: PullState;
	projects: Record<string, string>;
	refs: Record<string, string>;
};

/**
 * Incremental refresh: one `/v1/cursor` request when nothing moved, otherwise
 * only arrivals since the held mark (soma's table-pull helper), applied to the
 * R2 cache. Returns null when the token lacks the `hub_at` grants the cursor
 * needs, so the caller falls back to the chunked batched read.
 */
export async function refreshSoma(
	config: Config,
	bucket: R2Bucket,
	fetcher: typeof fetch = fetch,
	{ full = false } = {}
): Promise<{ freshCount: number } | null> {
	const { binding } = config;
	const sourceKey = await sourceKeyOf(config);
	const [stored, current] = await Promise.all([bucket.get(PULL_KEY), bucket.head(CACHE_KEY)]);
	const file = stored ? ((await stored.json()) as PullFile) : null;
	const held =
		!full && file?.sourceKey === sourceKey && current && file.cache === current.etag ? file : null;
	let pulled;
	try {
		pulled = await pullTables({
			endpoint: config.url,
			token: config.token,
			state: held?.state,
			tables: {
				[binding.table]: [...Object.values(binding.columns), 'updated_at'],
				[binding.projects.table]: [binding.projects.title]
			},
			// Workers reject 'error'; a manual redirect is not ok and the helper throws.
			fetch: (url, init) =>
				fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20000) })
		});
	} catch (error) {
		if ((error as { status?: number }).status === 403) return null;
		throw error;
	}
	if (pulled.requests === 1) return { freshCount: 0 };

	const taskChanges = pulled.changes[binding.table];
	const projectChanges = pulled.changes[binding.projects.table];
	const projects = new Map(projectChanges.full ? [] : Object.entries(held!.projects));
	for (const id of projectChanges.deleted) projects.delete(id);
	for (const row of projectChanges.rows) projects.set(row.id, text(row[binding.projects.title]));

	const [base, tagColors] = await Promise.all([
		taskChanges.full
			? { tasks: [], lastFullRefreshAt: new Date().toISOString() }
			: readCacheObject(bucket),
		fetchTagColors(config, fetcher)
	]);
	const byId = new Map(base.tasks.map((t) => [t.id, t]));
	const refs = new Map(taskChanges.full ? [] : Object.entries(held!.refs));
	for (const id of taskChanges.deleted) {
		byId.delete(id);
		refs.delete(id);
	}
	for (const row of taskChanges.rows) {
		byId.set(row.id, toTask(row, binding, projects));
		const first = array(row[binding.columns.projectIds])[0];
		if (first === undefined) refs.delete(row.id);
		else refs.set(row.id, first);
	}
	// A project rename or tombstone relabels tasks the pull did not return.
	for (const t of byId.values()) t.projectName = projectName(refs.get(t.id), projects);

	const data: TaskCache = {
		...summarize([...byId.values()], tagColors),
		lastFullRefreshAt: base.lastFullRefreshAt
	};
	const written = await bucket.put(CACHE_KEY, JSON.stringify(data), {
		httpMetadata: { contentType: 'application/json' }
	});
	const next: PullFile = {
		sourceKey,
		cache: written.etag,
		state: pulled.state,
		projects: Object.fromEntries(projects),
		refs: Object.fromEntries(refs)
	};
	await bucket.put(PULL_KEY, JSON.stringify(next));
	return { freshCount: taskChanges.rows.length + taskChanges.deleted.length };
}

async function readCacheObject(bucket: R2Bucket): Promise<TaskCache> {
	const obj = await bucket.get(CACHE_KEY);
	if (!obj) throw new Error('Task cache vanished during refresh');
	return (await obj.json()) as TaskCache;
}
