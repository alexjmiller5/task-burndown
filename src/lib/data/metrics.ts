import type { GroupBy, Task } from '$lib/types.js';
import { getGroupKeys } from './calculator.ts';
import { addDays, toLocalDateStr } from './timezone.ts';

export type FlowBucket = 'day' | 'week' | 'month';

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
