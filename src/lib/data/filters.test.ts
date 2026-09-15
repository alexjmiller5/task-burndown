import { expect, test } from 'vitest';
import {
	applyBaseFilters,
	applyViewFilters,
	isSameDay,
	PROJECT_KINDS,
	SAME_DAY_KINDS,
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

const ALL: FilterOptions = {
	hiddenStatuses: [],
	projectKinds: PROJECT_KINDS,
	sameDayKinds: SAME_DAY_KINDS,
	tz: 'UTC'
};

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

test('applyViewFilters hides only the hidden statuses', () => {
	const tasks = [
		makeTask(),
		makeTask({ id: 'c', status: 'Canceled' }),
		makeTask({ id: 'd', status: 'Completed' })
	];
	expect(ids(applyViewFilters(tasks, { ...ALL, hiddenStatuses: ['Canceled'] }))).toEqual([
		'task-1',
		'd'
	]);
	expect(ids(applyViewFilters(tasks, ALL))).toEqual(['task-1', 'c', 'd']);
});

test('applyViewFilters narrows by project kind', () => {
	const tasks = [makeTask(), makeTask({ id: 'p', hasProject: true, projectName: 'X' })];
	expect(ids(applyViewFilters(tasks, { ...ALL, projectKinds: ['project'] }))).toEqual(['p']);
	expect(ids(applyViewFilters(tasks, { ...ALL, projectKinds: ['none'] }))).toEqual(['task-1']);
	expect(ids(applyViewFilters(tasks, ALL))).toEqual(['task-1', 'p']);
});

test('isSameDay: effective start equals completion day, in the given tz', () => {
	const same = makeTask({
		created: '2026-05-01T15:00:00.000Z',
		completed: '2026-05-01T20:00:00.000Z'
	});
	const later = makeTask({
		created: '2026-05-01T15:00:00.000Z',
		completed: '2026-05-03T20:00:00.000Z'
	});
	// due date months later but knocked out early: start clamps to the completion day
	const early = makeTask({ dueDate: '2026-09-01', completed: '2026-05-02T20:00:00.000Z' });
	expect(isSameDay(same, 'UTC')).toEqual(true);
	expect(isSameDay(later, 'UTC')).toEqual(false);
	expect(isSameDay(early, 'UTC')).toEqual(true);
	expect(isSameDay(makeTask(), 'UTC')).toEqual(false);
	// 23:30Z created, 00:30Z next day completed: same day in Los Angeles, not in UTC
	const tzEdge = makeTask({
		created: '2026-05-01T23:30:00.000Z',
		completed: '2026-05-02T00:30:00.000Z'
	});
	expect(isSameDay(tzEdge, 'UTC')).toEqual(false);
	expect(isSameDay(tzEdge, 'America/Los_Angeles')).toEqual(true);
});

test('applyViewFilters narrows by same-day kind', () => {
	const tasks = [makeTask(), makeTask({ id: 's', completed: '2026-05-01T20:00:00.000Z' })];
	expect(ids(applyViewFilters(tasks, { ...ALL, sameDayKinds: ['same'] }))).toEqual(['s']);
	expect(ids(applyViewFilters(tasks, { ...ALL, sameDayKinds: ['other'] }))).toEqual(['task-1']);
});
