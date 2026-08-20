import { expect, test } from 'vitest';
import { calculateFlows } from './metrics.ts';
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
		hasProject: false,
		lastEditedTime: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}

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
