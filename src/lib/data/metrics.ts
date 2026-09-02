import type { DayCount, Task } from '$lib/types.js';
import { getTaskStartDate } from './calculator.ts';
import { addDays, diffDays, toLocalDateStr } from './timezone.ts';

export type FlowBucket = 'day' | 'week' | 'month';

export interface CompletionRow {
	label: string;
	/** Completions of tasks that started on an earlier day (backlog burndown). */
	backlog: number;
	/** Completions of tasks whose effective start was the completion day itself. */
	sameDay: number;
}

export function bucketLabel(dateStr: string, bucket: FlowBucket): string {
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
 * Completion counts per bucket covering [start, end], zero-filled, split into
 * backlog completions vs same-day turnaround (effective start = completion
 * day — the churn the burndown nets to zero).
 */
export function calculateCompletions(
	tasks: Task[],
	tz: string,
	bucket: FlowBucket,
	start: string,
	end: string
): CompletionRow[] {
	const rows = new Map<string, CompletionRow>();
	let label = bucketLabel(start, bucket);
	const lastLabel = bucketLabel(end, bucket);
	while (label <= lastLabel) {
		rows.set(label, { label, backlog: 0, sameDay: 0 });
		label = nextBucket(label, bucket);
	}

	for (const task of tasks) {
		if (!task.completed) continue;
		const dateStr = toLocalDateStr(task.completed, tz);
		if (dateStr < start || dateStr > end) continue;
		const row = rows.get(bucketLabel(dateStr, bucket));
		if (!row) continue;
		row[getTaskStartDate(task, tz) === dateStr ? 'sameDay' : 'backlog'] += 1;
	}
	return Array.from(rows.values());
}

/**
 * Downsample a daily series to one entry per bucket — the last day of each
 * bucket (an honest snapshot with a real date), for the Active view's
 * week/month buckets. 'day' passes through unchanged.
 */
export function sampleDailyCounts(days: DayCount[], bucket: FlowBucket): DayCount[] {
	if (bucket === 'day') return days;
	const lastPerBucket = new Map<string, DayCount>();
	for (const d of days) {
		lastPerBucket.set(bucketLabel(d.date, bucket), d);
	}
	return Array.from(lastPerBucket.values());
}

/**
 * Trailing `window`-day mean of the daily totals, keyed by date. With
 * `categories`, only those series are summed — so the line can track what the
 * legend actually shows instead of the all-series total.
 */
export function rollingAvgTotals(
	days: DayCount[],
	window = 14,
	categories?: string[]
): Record<string, number> {
	const dayTotal = (d: DayCount) =>
		categories
			? categories.reduce((sum, cat) => sum + ((d[cat] as number) || 0), 0)
			: (d.total as number);
	const out: Record<string, number> = {};
	let sum = 0;
	for (let i = 0; i < days.length; i++) {
		sum += dayTotal(days[i]);
		if (i >= window) sum -= dayTotal(days[i - window]);
		out[days[i].date] = sum / Math.min(i + 1, window);
	}
	return out;
}

/** Mean signed days from due date to completion across finished tasks; null if none. */
export function avgDueToCompletion(tasks: Task[], tz: string): number | null {
	let sum = 0;
	let n = 0;
	for (const t of tasks) {
		if (!t.dueDate || !t.completed) continue;
		sum += diffDays(toLocalDateStr(t.dueDate, tz), toLocalDateStr(t.completed, tz));
		n++;
	}
	return n === 0 ? null : sum / n;
}

/** Percentage of resolved tasks (completed or canceled) that were canceled; null if none resolved. */
export function cancelRate(tasks: Task[]): number | null {
	let canceled = 0;
	let completed = 0;
	for (const t of tasks) {
		if (t.status === 'Canceled' || t.status === 'Cancelled') canceled++;
		else if (t.status === 'Completed') completed++;
	}
	const resolved = canceled + completed;
	return resolved === 0 ? null : (100 * canceled) / resolved;
}
