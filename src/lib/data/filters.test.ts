import { expect, test } from 'vitest';
import { applyBaseFilters } from './filters.ts';
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

test('applyBaseFilters drops canceled tasks by default', () => {
	const tasks = [makeTask(), makeTask({ id: 'c', status: 'Canceled' })];
	expect(applyBaseFilters(tasks).map((t) => t.id)).toEqual(['task-1']);
});

test('applyBaseFilters keeps canceled tasks when includeCanceled is set', () => {
	const tasks = [makeTask(), makeTask({ id: 'c', status: 'Canceled' })];
	expect(applyBaseFilters(tasks, true).map((t) => t.id)).toEqual(['task-1', 'c']);
});

test('applyBaseFilters always drops useless-tagged tasks', () => {
	const tasks = [makeTask({ id: 'u', tags: ['useless'] })];
	expect(applyBaseFilters(tasks, true)).toEqual([]);
});
