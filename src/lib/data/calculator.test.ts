import { expect, test } from 'vitest';
import { AGE_BAND_ORDER, calculateDailyCounts } from './calculator.ts';
import { buildEventsMap } from './events.ts';
import type { Task } from '$lib/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: 'task-1',
		created: '2026-05-01T15:00:00.000Z',
		completed: null,
		dueDate: null,
		status: 'Active',
		tags: ['Work'],
		priority: 'Medium',
		projectName: '(No Project)',
		hasProject: false,
		lastEditedTime: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}

test('calculateDailyCounts — single active task, no completion', () => {
	const tasks = [makeTask({ dueDate: '2026-05-04', tags: ['Work'] })];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-04',
		limitDate: '2026-05-06',
		groupBy: 'tag',
		allCategories: ['Work'],
		selectedCategories: new Set(['Work'])
	});
	expect(result.length).toEqual(3);
	expect(result[0]).toEqual({ date: '2026-05-04', total: 1, Work: 1 });
	expect(result[1]).toEqual({ date: '2026-05-05', total: 1, Work: 1 });
	expect(result[2]).toEqual({ date: '2026-05-06', total: 1, Work: 1 });
});

test('calculateDailyCounts — task is gone from the count on its completion day', () => {
	const tasks = [
		makeTask({
			dueDate: '2026-05-04',
			completed: '2026-05-05',
			tags: ['Work']
		})
	];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-03',
		limitDate: '2026-05-07',
		groupBy: 'tag',
		allCategories: ['Work'],
		selectedCategories: new Set(['Work'])
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
	const tasks = [makeTask({ dueDate: '2026-05-04', completed: today, tags: ['Work'] })];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-04',
		limitDate: today,
		groupBy: 'tag',
		allCategories: ['Work'],
		selectedCategories: new Set(['Work'])
	});
	expect(result[0].total).toEqual(1); // 5/4 — still active
	expect(result[1].total).toEqual(0); // 5/5 — completed today, gone now
});

test('calculateDailyCounts — task NOT in selected category is not counted', () => {
	const tasks = [makeTask({ dueDate: '2026-05-04', tags: ['Work'] })];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-05-04',
		limitDate: '2026-05-05',
		groupBy: 'tag',
		allCategories: ['Work', 'Chore'],
		selectedCategories: new Set(['Chore']) // Work not selected
	});
	expect(result[0].total).toEqual(0);
	expect(result[0].Work).toEqual(0);
	expect(result[0].Chore).toEqual(0);
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
	const tasks = [makeTask({ dueDate: '2026-03-07', tags: ['Work'] })];
	const events = buildEventsMap(tasks, 'America/New_York');
	const result = calculateDailyCounts({
		events,
		minDate: '2026-03-07',
		limitDate: '2026-03-10',
		groupBy: 'tag',
		allCategories: ['Work'],
		selectedCategories: new Set(['Work'])
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
