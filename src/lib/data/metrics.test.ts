import { expect, test } from 'vitest';
import { calculateDailyMetrics, calculateFlows, pickFlowBucket } from './metrics.ts';
import type { Task } from '$lib/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: 'task-1',
		created: '2026-05-01T15:00:00.000Z',
		completed: null,
		dueDate: null,
		status: 'To Do',
		tags: ['Work'],
		priority: 'Medium',
		projectName: '(No Project)',
		history: [],
		hasProject: false,
		lastEditedTime: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}

test('openAvgAge grows day by day for a single open task', () => {
	const tasks = [makeTask({ created: '2026-05-01T12:00:00.000Z' })];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-01', '2026-05-05');
	expect(days.map((d) => d.openAvgAge)).toEqual([0, 1, 2, 3, 4]);
});

test('openAvgAge averages across open tasks and is null when none are open', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-05-01T12:00:00.000Z', completed: '2026-05-03' }),
		makeTask({ id: 'b', created: '2026-05-03T12:00:00.000Z' })
	];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-01', '2026-05-04');
	// 05-01: only a (age 0); 05-02: a (age 1); 05-03: a completes, b enters (age 0); 05-04: b (age 1)
	expect(days.map((d) => d.openAvgAge)).toEqual([0, 1, 0, 1]);
});

test('a burst of new tasks dilutes openAvgAge but not openP90Age', () => {
	const tasks = [
		makeTask({ id: 'old', created: '2026-05-01T12:00:00.000Z' }),
		makeTask({ id: 'n1', created: '2026-05-11T12:00:00.000Z' }),
		makeTask({ id: 'n2', created: '2026-05-11T12:00:00.000Z' }),
		makeTask({ id: 'n3', created: '2026-05-11T12:00:00.000Z' })
	];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-11', '2026-05-11');
	expect(days[0].openAvgAge).toEqual(2.5); // ages 10,0,0,0
	expect(days[0].openP90Age).toEqual(10); // the old tail is unmoved by the burst
});

test('openP90Age is the age of the 90th-percentile-oldest task', () => {
	// 10 tasks: one per created day 05-01..05-10 → ages 9..0 on 05-10
	const tasks = Array.from({ length: 10 }, (_, i) =>
		makeTask({ id: `t${i}`, created: `2026-05-${String(i + 1).padStart(2, '0')}T12:00:00.000Z` })
	);
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-10', '2026-05-10');
	expect(days[0].openP90Age).toEqual(8); // rank ceil(0.9*10)=9 of ages 0..9
});

test('tasks with Completed status but no completed date are excluded from the open pool', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-05-01T12:00:00.000Z', status: 'Completed' }),
		makeTask({ id: 'b', created: '2026-05-03T12:00:00.000Z' })
	];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-03', '2026-05-03');
	expect(days[0].openAvgAge).toEqual(0); // only b counts
});

test('completedMedianAge covers a rolling 14-day window and clamps negative ages', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-05-01T12:00:00.000Z', completed: '2026-05-11' }),
		// backdated: completed before created — age clamps to 0
		makeTask({ id: 'b', created: '2026-05-12T12:00:00.000Z', completed: '2026-05-11' })
	];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-10', '2026-05-26');
	const by = Object.fromEntries(days.map((d) => [d.date, d.completedMedianAge]));
	expect(by['2026-05-10']).toBeNull();
	expect(by['2026-05-11']).toEqual(5); // ages 10 and 0 → median 5
	expect(by['2026-05-24']).toEqual(5); // still inside the 14-day window
	expect(by['2026-05-25']).toBeNull(); // window has moved past 05-11
});

test('pickFlowBucket scales with the visible range', () => {
	expect(pickFlowBucket('2026-08-01', '2026-08-31')).toEqual('day');
	expect(pickFlowBucket('2026-05-01', '2026-08-01')).toEqual('week');
	expect(pickFlowBucket('2025-08-01', '2026-08-18')).toEqual('month');
});

test('calculateFlows buckets counts by day and group category, zero-filled', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-07-01T12:00:00.000Z', priority: 'High' }),
		makeTask({ id: 'b', created: '2026-07-01T15:00:00.000Z', completed: '2026-07-03' }),
		// completed carries a timestamp with offset in real data
		makeTask({
			id: 'c',
			created: '2026-06-20T12:00:00.000Z',
			completed: '2026-07-02T22:13:00.000-04:00'
		})
	];
	const rows = calculateFlows(
		tasks,
		'America/New_York',
		'day',
		'2026-07-01',
		'2026-07-03',
		'priority'
	);
	expect(rows).toEqual([
		{ label: '2026-07-01', created: { High: 1, Medium: 1 }, completed: {} },
		{ label: '2026-07-02', created: {}, completed: { Medium: 1 } },
		{ label: '2026-07-03', created: {}, completed: { Medium: 1 } }
	]);
});

test('calculateFlows counts a multi-tag task under each of its tags', () => {
	const tasks = [makeTask({ created: '2026-07-01T12:00:00.000Z', tags: ['Work', 'Errand'] })];
	const rows = calculateFlows(tasks, 'UTC', 'day', '2026-07-01', '2026-07-01', 'tag');
	expect(rows[0].created).toEqual({ Work: 1, Errand: 1 });
});

test('calculateFlows tags an untagged task as (Untagged)', () => {
	const tasks = [makeTask({ created: '2026-07-01T12:00:00.000Z', tags: [] })];
	const rows = calculateFlows(tasks, 'UTC', 'day', '2026-07-01', '2026-07-01', 'tag');
	expect(rows[0].created).toEqual({ '(Untagged)': 1 });
});

test('calculateFlows age group-by buckets completions by age at completion', () => {
	const tasks = [
		makeTask({ id: 'old', created: '2026-01-01T12:00:00.000Z', completed: '2026-08-01' }),
		makeTask({ id: 'new', created: '2026-08-01T12:00:00.000Z' })
	];
	const rows = calculateFlows(tasks, 'UTC', 'day', '2026-08-01', '2026-08-01', 'age');
	expect(rows[0].created).toEqual({ '<1w': 1 });
	expect(rows[0].completed).toEqual({ '6m+': 1 });
});

test('calculateFlows week buckets start on Monday', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-07-07T12:00:00.000Z' }), // Tue of week 07-06
		makeTask({ id: 'b', created: '2026-07-13T12:00:00.000Z' }) // Mon of week 07-13
	];
	const rows = calculateFlows(tasks, 'UTC', 'week', '2026-07-06', '2026-07-19', 'priority');
	expect(rows).toEqual([
		{ label: '2026-07-06', created: { Medium: 1 }, completed: {} },
		{ label: '2026-07-13', created: { Medium: 1 }, completed: {} }
	]);
});

test('calculateFlows month buckets answer "how many did I create in July"', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-07-07T12:00:00.000Z' }),
		makeTask({ id: 'b', created: '2026-07-20T12:00:00.000Z', completed: '2026-08-02' }),
		makeTask({ id: 'c', created: '2026-06-30T12:00:00.000Z' })
	];
	const rows = calculateFlows(tasks, 'UTC', 'month', '2026-06-15', '2026-08-10', 'priority');
	expect(rows).toEqual([
		{ label: '2026-06', created: { Medium: 1 }, completed: {} },
		{ label: '2026-07', created: { Medium: 2 }, completed: {} },
		{ label: '2026-08', created: {}, completed: { Medium: 1 } }
	]);
});
