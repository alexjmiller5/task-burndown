import { expect, test } from 'vitest';
import {
	avgDueToCompletion,
	calculateCompletions,
	cancelRate,
	rollingAvgTotals,
	sampleDailyCounts
} from './metrics.ts';
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
		aiCompleted: false,
		hasProject: false,
		lastEditedTime: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}

test('calculateCompletions buckets completions by day, zero-filled', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-07-01T12:00:00.000Z' }), // open — invisible
		makeTask({ id: 'b', created: '2026-07-01T15:00:00.000Z', completed: '2026-07-03' }),
		// completed carries a timestamp with offset in real data
		makeTask({
			id: 'c',
			created: '2026-06-20T12:00:00.000Z',
			completed: '2026-07-02T22:13:00.000-04:00'
		})
	];
	const rows = calculateCompletions(tasks, 'America/New_York', 'day', '2026-07-01', '2026-07-03');
	expect(rows).toEqual([
		{ label: '2026-07-01', backlog: 0, sameDay: 0, added: 2 },
		{ label: '2026-07-02', backlog: 1, sameDay: 0, added: 0 },
		{ label: '2026-07-03', backlog: 1, sameDay: 0, added: 0 }
	]);
});

test('calculateCompletions splits out tasks created and completed the same day', () => {
	const tasks = [
		makeTask({ id: 'quick', created: '2026-07-01T12:00:00.000Z', completed: '2026-07-01' }),
		makeTask({ id: 'slow', created: '2026-06-01T12:00:00.000Z', completed: '2026-07-01' })
	];
	const rows = calculateCompletions(tasks, 'UTC', 'day', '2026-07-01', '2026-07-01');
	expect(rows).toEqual([{ label: '2026-07-01', backlog: 1, sameDay: 1, added: 0 }]);
});

test('calculateCompletions counts a deferred task finished early as same-day (clamped start)', () => {
	// Due after completion → effective start clamps to the completion day
	const tasks = [
		makeTask({
			id: 'early',
			created: '2026-06-01T12:00:00.000Z',
			dueDate: '2026-09-01',
			completed: '2026-07-01'
		})
	];
	const rows = calculateCompletions(tasks, 'UTC', 'day', '2026-07-01', '2026-07-01');
	expect(rows).toEqual([{ label: '2026-07-01', backlog: 0, sameDay: 1, added: 0 }]);
});

test('calculateCompletions — a backfilled task completed on entry is backlog, not same-day', () => {
	// Entered and finished 08-23, but due months earlier: the effective start is
	// the due date (matching the burndown), so this is a months-old obligation
	// finally knocked out — not same-day churn.
	const task = makeTask({
		created: '2026-08-23T12:00:00.000Z',
		dueDate: '2026-04-20',
		completed: '2026-08-23'
	});
	const rows = calculateCompletions([task], 'America/New_York', 'day', '2026-08-23', '2026-08-23');
	expect(rows).toEqual([{ label: '2026-08-23', backlog: 1, sameDay: 0, added: 0 }]);
});

test('calculateCompletions week buckets start on Monday', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-06-01T12:00:00.000Z', completed: '2026-07-07' }), // Tue of week 07-06
		makeTask({ id: 'b', created: '2026-06-01T12:00:00.000Z', completed: '2026-07-13' }) // Mon of week 07-13
	];
	const rows = calculateCompletions(tasks, 'UTC', 'week', '2026-07-06', '2026-07-19');
	expect(rows).toEqual([
		{ label: '2026-07-06', backlog: 1, sameDay: 0, added: 0 },
		{ label: '2026-07-13', backlog: 1, sameDay: 0, added: 0 }
	]);
});

test('calculateCompletions month buckets answer "how many did I finish in July"', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-06-01T12:00:00.000Z', completed: '2026-07-07' }),
		makeTask({ id: 'b', created: '2026-07-20T12:00:00.000Z', completed: '2026-07-20' }),
		makeTask({ id: 'c', created: '2026-06-01T12:00:00.000Z', completed: '2026-08-02' })
	];
	const rows = calculateCompletions(tasks, 'UTC', 'month', '2026-06-15', '2026-08-10');
	expect(rows).toEqual([
		{ label: '2026-06', backlog: 0, sameDay: 0, added: 0 },
		{ label: '2026-07', backlog: 1, sameDay: 1, added: 0 },
		{ label: '2026-08', backlog: 1, sameDay: 0, added: 0 }
	]);
});

test('calculateCompletions counts tasks added to the backlog, excluding same-day churn', () => {
	const tasks = [
		makeTask({ id: 'open', created: '2026-07-01T12:00:00.000Z' }), // joins the pile
		makeTask({ id: 'later', created: '2026-07-01T15:00:00.000Z', completed: '2026-07-05' }),
		makeTask({ id: 'churn', created: '2026-07-01T18:00:00.000Z', completed: '2026-07-01' }),
		makeTask({ id: 'due', created: '2026-05-01T12:00:00.000Z', dueDate: '2026-07-02' }) // becomes due = added
	];
	const rows = calculateCompletions(tasks, 'UTC', 'day', '2026-07-01', '2026-07-05');
	expect(rows[0]).toEqual({ label: '2026-07-01', backlog: 0, sameDay: 1, added: 2 });
	expect(rows[1]).toEqual({ label: '2026-07-02', backlog: 0, sameDay: 0, added: 1 });
	expect(rows[4]).toEqual({ label: '2026-07-05', backlog: 1, sameDay: 0, added: 0 });
});

test('sampleDailyCounts keeps the last day of each week bucket', () => {
	const days = [
		{ date: '2026-07-07', total: 5 }, // Tue, week of 07-06
		{ date: '2026-07-12', total: 8 }, // Sun, week of 07-06
		{ date: '2026-07-13', total: 9 }, // Mon, week of 07-13 (partial)
		{ date: '2026-07-14', total: 11 }
	];
	expect(sampleDailyCounts(days, 'week')).toEqual([
		{ date: '2026-07-12', total: 8 },
		{ date: '2026-07-14', total: 11 }
	]);
});

test('sampleDailyCounts month buckets and day passthrough', () => {
	const days = [
		{ date: '2026-06-29', total: 2 },
		{ date: '2026-06-30', total: 3 },
		{ date: '2026-07-01', total: 4 }
	];
	expect(sampleDailyCounts(days, 'month')).toEqual([
		{ date: '2026-06-30', total: 3 },
		{ date: '2026-07-01', total: 4 }
	]);
	expect(sampleDailyCounts(days, 'day')).toEqual(days);
});

test('rollingAvgTotals is the trailing 14-day mean of totals', () => {
	const days = Array.from({ length: 20 }, (_, i) => ({
		date: `2026-05-${String(i + 1).padStart(2, '0')}`,
		total: i + 1
	}));
	const avg = rollingAvgTotals(days);
	expect(avg['2026-05-01']).toEqual(1); // window of 1
	expect(avg['2026-05-03']).toEqual(2); // mean of 1..3
	expect(avg['2026-05-14']).toEqual(7.5); // mean of 1..14
	expect(avg['2026-05-20']).toEqual(13.5); // mean of 7..20
});

test('rollingAvgTotals with categories averages only those series', () => {
	const days = Array.from({ length: 16 }, (_, i) => ({
		date: `2026-05-${String(i + 1).padStart(2, '0')}`,
		total: 100, // deliberately wrong, must be ignored
		High: 5,
		Low: 3
	}));
	const avg = rollingAvgTotals(days, 14, ['Low']);
	expect(avg['2026-05-01']).toEqual(3);
	expect(avg['2026-05-16']).toEqual(3);
	const both = rollingAvgTotals(days, 14, ['High', 'Low']);
	expect(both['2026-05-16']).toEqual(8);
});

test('avgDueToCompletion averages signed days from due date to completion', () => {
	const tasks = [
		makeTask({ id: 'late', dueDate: '2026-05-01', completed: '2026-05-04' }), // +3
		makeTask({ id: 'early', dueDate: '2026-05-10', completed: '2026-05-08' }), // -2
		makeTask({ id: 'no-due', completed: '2026-05-08' }),
		makeTask({ id: 'open', dueDate: '2026-05-10' })
	];
	expect(avgDueToCompletion(tasks, 'UTC')).toEqual(0.5);
	expect(avgDueToCompletion([makeTask()], 'UTC')).toBeNull();
});

test('cancelRate is the percentage of resolved tasks that were canceled', () => {
	const tasks = [
		makeTask({ id: 'c1', status: 'Canceled' }),
		makeTask({ id: 'd1', status: 'Completed' }),
		makeTask({ id: 'd2', status: 'Completed' }),
		makeTask({ id: 'd3', status: 'Completed' }),
		makeTask({ id: 'open', status: 'To Do' }) // unresolved: not in the denominator
	];
	expect(cancelRate(tasks)).toEqual(25);
	expect(cancelRate([makeTask({ status: 'To Do' })])).toBeNull();
});
