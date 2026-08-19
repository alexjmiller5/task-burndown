import type { GroupBy, Task } from '$lib/types.js';
import { getGroupKeys } from './calculator.ts';
import { addDays, diffDays, toLocalDateStr } from './timezone.ts';

export interface DayMetrics {
	date: string;
	/** Mean days-since-created among tasks open on this day; null if none. */
	openAvgAge: number | null;
	/** Age of the 90th-percentile-oldest open task — robust to bursts of new tasks. */
	openP90Age: number | null;
	/** Median age at completion across the trailing 14 days; null if no completions. */
	completedMedianAge: number | null;
}

const COMPLETED_WINDOW = 14;

function median(sorted: number[]): number | null {
	const n = sorted.length;
	if (n === 0) return null;
	const mid = n >> 1;
	return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function toEpochDay(dateStr: string): number {
	const [y, m, d] = dateStr.split('-').map(Number);
	return Date.UTC(y, m - 1, d) / 86_400_000;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const arr = map.get(key);
	if (arr) arr.push(value);
	else map.set(key, [value]);
}

/**
 * Day-by-day age and push-back series over [minDate, limitDate].
 * A task is "open" from its created day until (exclusive) its completed day.
 * Terminal-status tasks without a completed date have an unknown exit day and
 * are excluded from the open pool rather than polluting it forever.
 */
export function calculateDailyMetrics(
	tasks: Task[],
	tz: string,
	minDate: string,
	limitDate: string
): DayMetrics[] {
	const enterByDay = new Map<string, string[]>(); // day -> created-date strs entering the pool
	const exitByDay = new Map<string, string[]>();
	const completedAgesByDay = new Map<string, number[]>();

	for (const task of tasks) {
		const created = toLocalDateStr(task.created, tz);
		const completed = task.completed ? toLocalDateStr(task.completed, tz) : null;

		if (completed) {
			push(completedAgesByDay, completed, Math.max(0, diffDays(created, completed)));
			// completed before created (backdated): never in the open pool
			if (completed > created) {
				push(enterByDay, created, created);
				push(exitByDay, completed, created);
			}
		} else if (task.status !== 'Completed') {
			push(enterByDay, created, created);
		}
	}

	// Sorted multiset of created dates of open tasks (small pool, splice is fine)
	const pool: string[] = [];
	let createdEpochSum = 0;
	function insert(v: string) {
		createdEpochSum += toEpochDay(v);
		let lo = 0,
			hi = pool.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (pool[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		pool.splice(lo, 0, v);
	}
	function remove(v: string) {
		let lo = 0,
			hi = pool.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (pool[mid] < v) lo = mid + 1;
			else hi = mid;
		}
		if (pool[lo] === v) {
			pool.splice(lo, 1);
			createdEpochSum -= toEpochDay(v);
		}
	}

	// Warm up the pool with everything that entered/exited before minDate
	for (const [day, values] of enterByDay) {
		if (day < minDate) for (const v of values) insert(v);
	}
	for (const [day, values] of exitByDay) {
		if (day < minDate) for (const v of values) remove(v);
	}

	const result: DayMetrics[] = [];
	let date = minDate;
	while (date <= limitDate) {
		for (const v of enterByDay.get(date) ?? []) insert(v);
		for (const v of exitByDay.get(date) ?? []) remove(v);

		const n = pool.length;
		const openAvgAge = n === 0 ? null : toEpochDay(date) - createdEpochSum / n;
		// pool is ascending by created date, i.e. descending by age; nearest-rank
		// p90 of ascending ages is rank ceil(0.9n) → pool index n - ceil(0.9n)
		const openP90Age = n === 0 ? null : diffDays(pool[n - Math.ceil(0.9 * n)], date);

		const windowAges: number[] = [];
		for (let i = 0; i < COMPLETED_WINDOW; i++) {
			const d = addDays(date, -i);
			const ages = completedAgesByDay.get(d);
			if (ages) windowAges.push(...ages);
		}
		windowAges.sort((a, b) => a - b);

		result.push({ date, openAvgAge, openP90Age, completedMedianAge: median(windowAges) });
		date = addDays(date, 1);
	}
	return result;
}

export type FlowBucket = 'day' | 'week' | 'month';

export function pickFlowBucket(start: string, end: string): FlowBucket {
	const days = diffDays(start, end);
	if (days <= 45) return 'day';
	if (days <= 270) return 'week';
	return 'month';
}

export interface FlowRow {
	label: string;
	created: Record<string, number>;
	completed: Record<string, number>;
}

function bucketLabel(dateStr: string, bucket: FlowBucket): string {
	if (bucket === 'day') return dateStr;
	if (bucket === 'month') return dateStr.slice(0, 7);
	// week starting Monday
	const [y, m, d] = dateStr.split('-').map(Number);
	const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
	return addDays(dateStr, -((weekday + 6) % 7));
}

function nextBucket(label: string, bucket: FlowBucket): string {
	if (bucket === 'day') return addDays(label, 1);
	if (bucket === 'week') return addDays(label, 7);
	const [y, m] = label.split('-').map(Number);
	return `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}`;
}

/**
 * Created/completed counts per bucket covering [start, end], zero-filled and
 * broken down by the group keys each task had on the event's day (a multi-tag
 * task counts under each tag, mirroring the chart's stacking semantics).
 */
export function calculateFlows(
	tasks: Task[],
	tz: string,
	bucket: FlowBucket,
	start: string,
	end: string,
	groupBy: GroupBy
): FlowRow[] {
	const rows = new Map<string, FlowRow>();
	let label = bucketLabel(start, bucket);
	const lastLabel = bucketLabel(end, bucket);
	while (label <= lastLabel) {
		rows.set(label, { label, created: {}, completed: {} });
		label = nextBucket(label, bucket);
	}

	function count(dateStr: string, task: Task, side: 'created' | 'completed') {
		if (dateStr < start || dateStr > end) return;
		const row = rows.get(bucketLabel(dateStr, bucket));
		if (!row) return;
		for (const key of getGroupKeys(task, groupBy, dateStr, tz)) {
			row[side][key] = (row[side][key] ?? 0) + 1;
		}
	}

	for (const task of tasks) {
		count(toLocalDateStr(task.created, tz), task, 'created');
		if (task.completed) count(toLocalDateStr(task.completed, tz), task, 'completed');
	}
	return Array.from(rows.values());
}
