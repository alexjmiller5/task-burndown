import { expect, test } from 'vitest';
import {
	applyBaseFilters,
	applyViewFilters,
	PROJECT_KINDS,
	type FilterOptions
} from './filters.ts';
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

const ALL: FilterOptions = { projectKinds: PROJECT_KINDS };

const ids = (tasks: Task[]) => tasks.map((t) => t.id);

test('applyBaseFilters always drops useless-tagged and created-less tasks', () => {
	const tasks = [
		makeTask(),
		makeTask({ id: 'u', tags: ['useless'] }),
		makeTask({ id: 'n', created: '' })
	];
	expect(ids(applyBaseFilters(tasks))).toEqual(['task-1']);
});

test('applyViewFilters drops legacy tasks created before the cutoff', () => {
	const tasks = [makeTask(), makeTask({ id: 'old', created: '2024-12-01T00:00:00.000Z' })];
	expect(ids(applyViewFilters(tasks, ALL))).toEqual(['task-1']);
});

test('applyViewFilters narrows by project kind', () => {
	const tasks = [makeTask(), makeTask({ id: 'p', hasProject: true, projectName: 'X' })];
	expect(ids(applyViewFilters(tasks, { ...ALL, projectKinds: ['project'] }))).toEqual(['p']);
	expect(ids(applyViewFilters(tasks, { ...ALL, projectKinds: ['none'] }))).toEqual(['task-1']);
	expect(ids(applyViewFilters(tasks, ALL))).toEqual(['task-1', 'p']);
});
