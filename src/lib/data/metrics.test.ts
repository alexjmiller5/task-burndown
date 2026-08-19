import { expect, test } from 'vitest';
import { calculateDailyMetrics, calculateFlows, pickFlowBucket } from './metrics.ts';
import { parseHistoryLedger } from './history.ts';
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

test('openMedianAge grows day by day for a single open task', () => {
	const tasks = [makeTask({ created: '2026-05-01T12:00:00.000Z' })];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-01', '2026-05-05');
	expect(days.map((d) => d.openMedianAge)).toEqual([0, 1, 2, 3, 4]);
});

test('openMedianAge is the median across open tasks and null when none are open', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-05-01T12:00:00.000Z', completed: '2026-05-03' }),
		makeTask({ id: 'b', created: '2026-05-03T12:00:00.000Z' })
	];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-01', '2026-05-04');
	// 05-01: only a (age 0); 05-02: a (age 1); 05-03: a completes, b enters (age 0); 05-04: b (age 1)
	expect(days.map((d) => d.openMedianAge)).toEqual([0, 1, 0, 1]);
});

test('openMedianAge averages the two middle values for an even pool', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-05-01T12:00:00.000Z' }),
		makeTask({ id: 'b', created: '2026-05-04T12:00:00.000Z' })
	];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-04', '2026-05-04');
	expect(days[0].openMedianAge).toEqual(1.5); // ages 3 and 0
});

test('tasks with Completed status but no completed date are excluded from the open pool', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-05-01T12:00:00.000Z', status: 'Completed' }),
		makeTask({ id: 'b', created: '2026-05-03T12:00:00.000Z' })
	];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-03', '2026-05-03');
	expect(days[0].openMedianAge).toEqual(0); // only b counts
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

test('pushbacks is a rolling 7-day count of push-back events', () => {
	const history = parseHistoryLedger(
		'[2026-05-01 10:00] --- Tags: [], Due Date: 2026-05-02\n' +
			'[2026-05-02 10:00] --- Tags: [], Due Date: 2026-05-09'
	);
	const tasks = [makeTask({ created: '2026-05-01T12:00:00.000Z', history })];
	const days = calculateDailyMetrics(tasks, 'UTC', '2026-05-01', '2026-05-09');
	const by = Object.fromEntries(days.map((d) => [d.date, d.pushbacks]));
	expect(by['2026-05-01']).toEqual(0);
	expect(by['2026-05-02']).toEqual(1);
	expect(by['2026-05-08']).toEqual(1); // last day inside the window
	expect(by['2026-05-09']).toEqual(0);
});

test('pickFlowBucket scales with the visible range', () => {
	expect(pickFlowBucket('2026-08-01', '2026-08-31')).toEqual('day');
	expect(pickFlowBucket('2026-05-01', '2026-08-01')).toEqual('week');
	expect(pickFlowBucket('2025-08-01', '2026-08-18')).toEqual('month');
});

test('calculateFlows buckets created and completed counts by day, zero-filled', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-07-01T12:00:00.000Z' }),
		makeTask({ id: 'b', created: '2026-07-01T15:00:00.000Z', completed: '2026-07-03' }),
		// completed carries a timestamp with offset in real data
		makeTask({
			id: 'c',
			created: '2026-06-20T12:00:00.000Z',
			completed: '2026-07-02T22:13:00.000-04:00'
		})
	];
	const rows = calculateFlows(tasks, 'America/New_York', 'day', '2026-07-01', '2026-07-03');
	expect(rows).toEqual([
		{ label: '2026-07-01', created: 2, completed: 0 },
		{ label: '2026-07-02', created: 0, completed: 1 },
		{ label: '2026-07-03', created: 0, completed: 1 }
	]);
});

test('calculateFlows week buckets start on Monday', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-07-07T12:00:00.000Z' }), // Tue of week 07-06
		makeTask({ id: 'b', created: '2026-07-13T12:00:00.000Z' }) // Mon of week 07-13
	];
	const rows = calculateFlows(tasks, 'UTC', 'week', '2026-07-06', '2026-07-19');
	expect(rows).toEqual([
		{ label: '2026-07-06', created: 1, completed: 0 },
		{ label: '2026-07-13', created: 1, completed: 0 }
	]);
});

test('calculateFlows month buckets answer "how many did I create in July"', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-07-07T12:00:00.000Z' }),
		makeTask({ id: 'b', created: '2026-07-20T12:00:00.000Z', completed: '2026-08-02' }),
		makeTask({ id: 'c', created: '2026-06-30T12:00:00.000Z' })
	];
	const rows = calculateFlows(tasks, 'UTC', 'month', '2026-06-15', '2026-08-10');
	expect(rows).toEqual([
		{ label: '2026-06', created: 1, completed: 0 },
		{ label: '2026-07', created: 2, completed: 0 },
		{ label: '2026-08', created: 0, completed: 1 }
	]);
});
