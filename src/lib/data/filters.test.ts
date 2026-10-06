import { expect, test } from 'vitest';
import {
	applyBaseFilters,
	applyViewFilters,
	PROJECT_KINDS,
	type FilterOptions
} from './filters.ts';
import type { Task } from '$lib/types.js';
import { buildEventsMap, getMinDate } from './events.ts';
import { calculateDailyCounts } from './calculator.ts';
import { tasksInWindow, calculateCompletions } from './metrics.ts';

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

test.each(['Completed', 'Canceled', 'Cancelled'])(
	'%s tasks without a completion date do not become permanent backlog or invented completions',
	(status) => {
		const tasks = applyBaseFilters(
			[
				makeTask({ id: 'open', dueDate: '2026-05-01' }),
				makeTask({ id: 'undated-open', dueDate: null }),
				makeTask({ id: 'unknown-completion', status, priority: '(No Priority)' }),
				makeTask({ id: 'dated-completion', status, completed: '2026-05-02' })
			],
			true
		);
		const counts = calculateDailyCounts({
			events: buildEventsMap(tasks, 'UTC'),
			minDate: getMinDate(tasks, 'UTC'),
			limitDate: '2026-05-03',
			groupBy: 'priority',
			allCategories: ['Medium', '(No Priority)'],
			selectedCategories: new Set(['Medium', '(No Priority)']),
			tz: 'UTC'
		});
		expect(counts.map((day) => day.total)).toEqual([3, 2, 2]);
		expect(counts.map((day) => day['(No Priority)'])).toEqual([0, 0, 0]);
		expect(ids(tasksInWindow(tasks, 'UTC', '2026-05-01', '2026-05-03'))).toEqual([
			'open',
			'undated-open',
			'dated-completion'
		]);
		expect(
			calculateCompletions(tasks, 'UTC', 'day', '2026-05-01', '2026-05-03').map(
				(day) => day.backlog + day.sameDay
			)
		).toEqual([0, 1, 0]);
	}
);

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
