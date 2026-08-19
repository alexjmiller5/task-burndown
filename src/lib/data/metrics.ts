import type { Task } from '$lib/types.js';
import { getPushbackDates } from './history.ts';
import { addDays, diffDays, toLocalDateStr } from './timezone.ts';

export interface DayMetrics {
	date: string;
	/** Median days-since-created among tasks open on this day; null if none. */
	openMedianAge: number | null;
	/** Median age at completion across the trailing 14 days; null if no completions. */
	completedMedianAge: number | null;
	/** Push-back events in the trailing 7 days. */
	pushbacks: number;
}

const COMPLETED_WINDOW = 14;
const PUSHBACK_WINDOW = 7;

function median(sorted: number[]): number | null {
	const n = sorted.length;
	if (n === 0) return null;
	const mid = n >> 1;
	return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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
	const pushbacksByDay = new Map<string, number>();

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

		for (const d of getPushbackDates(task.history, completed)) {
			pushbacksByDay.set(d, (pushbacksByDay.get(d) ?? 0) + 1);
		}
	}

	// Sorted multiset of created dates of open tasks (small pool, splice is fine)
	const pool: string[] = [];
	function insert(v: string) {
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
		if (pool[lo] === v) pool.splice(lo, 1);
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

		const openMedianAge =
			pool.length === 0
				? null
				: // median of (date - created_i) = date - median(created_i): fractional
					// medians average two dates, so interpolate via the two neighbors
					pool.length % 2
					? diffDays(pool[pool.length >> 1], date)
					: (diffDays(pool[(pool.length >> 1) - 1], date) +
							diffDays(pool[pool.length >> 1], date)) /
						2;

		const windowAges: number[] = [];
		for (let i = 0; i < COMPLETED_WINDOW; i++) {
			const d = addDays(date, -i);
			const ages = completedAgesByDay.get(d);
			if (ages) windowAges.push(...ages);
		}
		windowAges.sort((a, b) => a - b);

		let pushbacks = 0;
		for (let i = 0; i < PUSHBACK_WINDOW; i++) {
			pushbacks += pushbacksByDay.get(addDays(date, -i)) ?? 0;
		}

		result.push({ date, openMedianAge, completedMedianAge: median(windowAges), pushbacks });
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
	created: number;
	completed: number;
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

/** Created/completed counts per bucket covering [start, end], zero-filled. */
export function calculateFlows(
	tasks: Task[],
	tz: string,
	bucket: FlowBucket,
	start: string,
	end: string
): FlowRow[] {
	const rows = new Map<string, FlowRow>();
	let label = bucketLabel(start, bucket);
	const lastLabel = bucketLabel(end, bucket);
	while (label <= lastLabel) {
		rows.set(label, { label, created: 0, completed: 0 });
		label = nextBucket(label, bucket);
	}

	for (const task of tasks) {
		const created = toLocalDateStr(task.created, tz);
		if (created >= start && created <= end) {
			const row = rows.get(bucketLabel(created, bucket));
			if (row) row.created++;
		}
		if (task.completed) {
			const completed = toLocalDateStr(task.completed, tz);
			if (completed >= start && completed <= end) {
				const row = rows.get(bucketLabel(completed, bucket));
				if (row) row.completed++;
			}
		}
	}
	return Array.from(rows.values());
}
