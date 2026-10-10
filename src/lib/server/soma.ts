import type { ParsedData, Task } from '$lib/types.js';
import { PRIORITY_ORDER } from '$lib/data/parser.js';

export type SomaEnv = {
	SOMA_TASKS_CONFIG?: string;
	SOMA_HUB_URL?: string;
	SOMA_HUB_TOKEN?: string;
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
	tagColors: Record<string, string>;
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
	if (
		!binding.tagColors ||
		typeof binding.tagColors !== 'object' ||
		Array.isArray(binding.tagColors) ||
		Object.values(binding.tagColors).some((c) => typeof c !== 'string')
	)
		throw new Error('SOMA_TASKS_CONFIG requires tagColors');
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
		const id = text(row.id);
		if (row.deleted_at) {
			deletedIds.push(id);
			continue;
		}
		const c = binding.columns;
		const ids = array(row[c.projectIds]);
		const ai = row[c.aiCompleted] === null ? false : row[c.aiCompleted];
		if (![true, false, 0, 1].includes(ai as boolean | number))
			throw new Error('Invalid task checkbox');
		tasks.push({
			id,
			created: text(row[c.created]),
			completed: optionalText(row[c.completed]),
			dueDate: optionalText(row[c.dueDate]),
			status: optionalText(row[c.status]) ?? '',
			tags: array(row[c.tags]),
			priority: optionalText(row[c.priority]) || '(No Priority)',
			projectName: ids.length ? (projects.get(ids[0]) ?? '(Unavailable Project)') : '(No Project)',
			hasProject: ids.length > 0,
			aiCompleted: ai === true || ai === 1,
			lastEditedTime: text(row.updated_at)
		});
	}
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify([config.url, binding]))
	);
	return {
		tasks,
		deletedIds,
		nextCursor: result.next_cursor,
		sourceKey: Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(''),
		allTags: [...new Set(['(Untagged)', ...tasks.flatMap((t) => t.tags)])].sort(),
		allPriorities: PRIORITY_ORDER.filter((p) => tasks.some((t) => t.priority === p)),
		allProjects: [...new Set(tasks.map((t) => t.projectName))].sort(),
		tagColors: { ...binding.tagColors, '(Untagged)': 'default' }
	};
}
