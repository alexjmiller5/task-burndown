import { expect, test } from 'vitest';
import {
	AGE_BAND_ORDER,
	AI_ORDER,
	calculateDailyCounts,
	getCategories,
	getGroupKeys
} from './calculator.ts';
import { buildEventsMap } from './events.ts';
import type { Task } from '$lib/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: 'task-1',
		created: '2026-05-01T15:00:00.000Z',
		completed: null,
		dueDate: null,
		status: 'Active',
		tags: ['Beta'],
		priority: 'Medium',
		projectName: '(No Project)',
		aiCompleted: false,
		hasProject: false,
		lastEditedTime: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}

test('calculateDailyCounts — single active task, no completion', () => {
	const tasks = [makeTask({ dueDate: '2026-05-04', tags: ['Beta'] })];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-04',
		limitDate: '2026-05-06',
		groupBy: 'tag',
		allCategories: ['Beta'],
		selectedCategories: new Set(['Beta'])
	});
	expect(result.length).toEqual(3);
	expect(result[0]).toEqual({ date: '2026-05-04', total: 1, Beta: 1 });
	expect(result[1]).toEqual({ date: '2026-05-05', total: 1, Beta: 1 });
	expect(result[2]).toEqual({ date: '2026-05-06', total: 1, Beta: 1 });
});

test('calculateDailyCounts — task is gone from the count on its completion day', () => {
	const tasks = [
		makeTask({
			dueDate: '2026-05-04',
			completed: '2026-05-05',
			tags: ['Beta']
		})
	];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-03',
		limitDate: '2026-05-07',
		groupBy: 'tag',
		allCategories: ['Beta'],
		selectedCategories: new Set(['Beta'])
	});
	expect(result[0].total).toEqual(0); // 5/3 — not yet active
	expect(result[1].total).toEqual(1); // 5/4 — created
	expect(result[2].total).toEqual(0); // 5/5 — completed: drop on the completion day
	expect(result[3].total).toEqual(0); // 5/6
	expect(result[4].total).toEqual(0); // 5/7
});

test("calculateDailyCounts — completed-today task is excluded from today's count", () => {
	// Mirrors the user's "Notion view says X, dashboard should match" expectation
	const today = '2026-05-05';
	const tasks = [makeTask({ dueDate: '2026-05-04', completed: today, tags: ['Beta'] })];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-04',
		limitDate: today,
		groupBy: 'tag',
		allCategories: ['Beta'],
		selectedCategories: new Set(['Beta'])
	});
	expect(result[0].total).toEqual(1); // 5/4 — still active
	expect(result[1].total).toEqual(0); // 5/5 — completed today, gone now
});

test('calculateDailyCounts — task NOT in selected category is not counted', () => {
	const tasks = [makeTask({ dueDate: '2026-05-04', tags: ['Beta'] })];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-04',
		limitDate: '2026-05-05',
		groupBy: 'tag',
		allCategories: ['Beta', 'Alpha'],
		selectedCategories: new Set(['Alpha']) // Beta not selected
	});
	expect(result[0].total).toEqual(0);
	expect(result[0].Beta).toEqual(0);
	expect(result[0].Alpha).toEqual(0);
});

test('calculateDailyCounts — minDate >= limitDate returns empty', () => {
	const result = calculateDailyCounts({
		events: new Map(),
		minDate: '2026-05-05',
		limitDate: '2026-05-04',
		groupBy: 'tag',
		allCategories: [],
		selectedCategories: new Set()
	});
	expect(result).toEqual([]);
});

test('calculateDailyCounts — DST spring forward day arithmetic', () => {
	// March 8 2026 is US spring forward day. The day-by-day loop should produce
	// March 7, 8, 9, 10 in sequence with no gaps or duplicates.
	const tasks = [makeTask({ dueDate: '2026-03-07', tags: ['Beta'] })];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-03-07',
		limitDate: '2026-03-10',
		groupBy: 'tag',
		allCategories: ['Beta'],
		selectedCategories: new Set(['Beta'])
	});
	const dates = result.map((r) => r.date);
	expect(dates).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
});

test('calculateDailyCounts — age group-by moves a task across band boundaries', () => {
	const tasks = [makeTask({ created: '2026-01-01T15:00:00.000Z' })];
	const events = buildEventsMap(tasks, 'UTC');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-01-01',
		limitDate: '2026-01-09',
		groupBy: 'age',
		allCategories: [...AGE_BAND_ORDER],
		selectedCategories: new Set(AGE_BAND_ORDER),
		tz: 'UTC'
	});
	const jan7 = result.find((d) => d.date === '2026-01-07')!;
	const jan8 = result.find((d) => d.date === '2026-01-08')!;
	expect(jan7['<1w']).toEqual(1);
	expect(jan7['1w-1m']).toEqual(0);
	expect(jan8['<1w']).toEqual(0);
	expect(jan8['1w-1m']).toEqual(1);
});

test('calculateDailyCounts — age group-by buckets an old task into 6m+', () => {
	const tasks = [makeTask({ created: '2025-01-01T15:00:00.000Z' })];
	const events = buildEventsMap(tasks, 'UTC');
	const result = calculateDailyCounts({
		events,
		minDate: '2025-01-01',
		limitDate: '2026-01-02',
		groupBy: 'age',
		allCategories: [...AGE_BAND_ORDER],
		selectedCategories: new Set(AGE_BAND_ORDER),
		tz: 'UTC'
	});
	const jan1 = result.find((d) => d.date === '2026-01-01')!;
	expect(jan1['6m+']).toEqual(1);
	expect(jan1['<1w']).toEqual(0);
});

test('calculateDailyCounts — ai group-by splits AI-completed from manual', () => {
	const tasks = [
		makeTask({ id: 'a', dueDate: '2026-05-04' }),
		makeTask({ id: 'b', dueDate: '2026-05-04', completed: '2026-05-06', aiCompleted: true }),
		makeTask({ id: 'c', dueDate: '2026-05-04' })
	];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-04',
		limitDate: '2026-05-05',
		groupBy: 'ai',
		allCategories: [...AI_ORDER],
		selectedCategories: new Set(AI_ORDER)
	});
	expect(result[0]['AI Completed']).toEqual(1);
	expect(result[0]['Manual']).toEqual(2);
});

test('getAgeBand — ages a backfilled task from its due date, not its created time', () => {
	// Typed in Aug 23, but due Apr 20: on May 20 it is a month old, not "new".
	const task = makeTask({ created: '2026-08-23T12:00:00.000Z', dueDate: '2026-04-20' });
	expect(getGroupKeys(task, 'age', '2026-04-21', 'America/New_York')).toEqual(['<1w']);
	expect(getGroupKeys(task, 'age', '2026-05-19', 'America/New_York')).toEqual(['1w-1m']);
	// 30 days exactly is already the next band up
	expect(getGroupKeys(task, 'age', '2026-05-20', 'America/New_York')).toEqual(['1-3m']);
});

test('getAgeBand — never reports a negative age for an early completion', () => {
	const task = makeTask({ dueDate: '2026-09-01', completed: '2026-08-17' });
	expect(getGroupKeys(task, 'age', '2026-08-17', 'America/New_York')).toEqual(['<1w']);
});

const parsed = (tasks: Task[], allTags: string[]) => ({
	tasks,
	allTags,
	allPriorities: ['Medium'],
	allProjects: ['(No Project)'],
	tagColors: {}
});

test('getCategories - the tag breakdown counts every tag in the data, untagged included', () => {
	const tasks = [
		makeTask({ id: 'a', dueDate: '2026-05-04', tags: ['Alpha'] }),
		makeTask({ id: 'g', dueDate: '2026-05-04', tags: ['Gamma'] }),
		makeTask({ id: 'u', dueDate: '2026-05-04', tags: [] })
	];
	const allCategories = getCategories('tag', parsed(tasks, ['(Untagged)', 'Alpha', 'Gamma']));
	const [day] = calculateDailyCounts({
		events: buildEventsMap(tasks, 'UTC'),
		minDate: '2026-05-04',
		limitDate: '2026-05-05',
		groupBy: 'tag',
		allCategories,
		selectedCategories: new Set(allCategories),
		tz: 'UTC'
	});
	expect(day).toMatchObject({ total: 3, Alpha: 1, Gamma: 1, '(Untagged)': 1 });
});

test('getCategories - statuses in workflow order, unknown ones after, blanks as (No Status)', () => {
	const tasks = ['Completed', 'Paused', '', 'To Do', 'Canceled', 'In Progress', 'To Do'].map(
		(status, i) => makeTask({ id: `t${i}`, status })
	);
	expect(getCategories('status', parsed(tasks, []))).toEqual([
		'To Do',
		'In Progress',
		'Completed',
		'Canceled',
		'(No Status)',
		'Paused'
	]);
});

test('getGroupKeys - status breakdown keys a task by its status', () => {
	expect(getGroupKeys(makeTask({ status: 'In Progress' }), 'status', '2026-05-04', 'UTC')).toEqual([
		'In Progress'
	]);
	expect(getGroupKeys(makeTask({ status: '' }), 'status', '2026-05-04', 'UTC')).toEqual([
		'(No Status)'
	]);
});

test('calculateDailyCounts - status group-by stacks open tasks by status', () => {
	const tasks = [
		makeTask({ id: 'a', dueDate: '2026-05-04', status: 'To Do' }),
		makeTask({ id: 'b', dueDate: '2026-05-04', status: 'In Progress' }),
		makeTask({ id: 'c', dueDate: '2026-05-04', status: 'Completed', completed: '2026-05-05' })
	];
	const allCategories = getCategories('status', parsed(tasks, []));
	const [may4, may5] = calculateDailyCounts({
		events: buildEventsMap(tasks, 'UTC'),
		minDate: '2026-05-04',
		limitDate: '2026-05-05',
		groupBy: 'status',
		allCategories,
		selectedCategories: new Set(allCategories),
		tz: 'UTC'
	});
	expect(may4).toMatchObject({ total: 3, 'To Do': 1, 'In Progress': 1, Completed: 1 });
	expect(may5).toMatchObject({ total: 2, 'To Do': 1, 'In Progress': 1, Completed: 0 });
});
