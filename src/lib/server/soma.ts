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

async function page(
	config: Config,
	table: string,
	columns: string[],
	cursor: string | null,
	fetcher: typeof fetch
) {
	const response = await fetcher(`${config.url}/v1/rows/pull`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			table,
			columns: [...new Set(['id', 'updated_at', 'deleted_at', ...columns])],
			since: '',
			limit: 200,
			...(cursor ? { after: cursor } : {})
		}),
		signal: AbortSignal.timeout(20000),
		// Workers reject 'error'; a manual redirect is not ok and fails below.
		redirect: 'manual'
	});
	if (!response.ok) throw new Error(`Soma read failed (${response.status})`);
	const body = (await response.json()) as { rows: Row[]; next_cursor: string | null };
	if (
		!Array.isArray(body.rows) ||
		!(body.next_cursor === null || (typeof body.next_cursor === 'string' && body.next_cursor))
	)
		throw new Error('Invalid Soma page receipt');
	return body;
}

/** A current paginated scan, not an immutable snapshot or backup. */
export async function fetchSomaChunk(
	config: Config,
	cursor: string | null,
	fetcher: typeof fetch = fetch
): Promise<ParsedData & { nextCursor: string | null; deletedIds: string[]; sourceKey: string }> {
	const { binding } = config;
	const projects = new Map<string, string>();
	const seen = new Set<string>();
	let projectCursor: string | null = null;
	do {
		const result = await page(
			config,
			binding.projects.table,
			[binding.projects.title],
			projectCursor,
			fetcher
		);
		for (const row of result.rows) {
			const id = text(row.id);
			if (row.deleted_at) projects.delete(id);
			else projects.set(id, text(row[binding.projects.title]));
		}
		projectCursor = result.next_cursor;
		if (projectCursor && seen.has(projectCursor)) throw new Error('Repeated project cursor');
		if (projectCursor) seen.add(projectCursor);
	} while (projectCursor);
	const result = await page(config, binding.table, Object.values(binding.columns), cursor, fetcher);
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
