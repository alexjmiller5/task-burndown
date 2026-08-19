import { expect, test } from 'vitest';
import { buildEventsMap, getMinDate } from './events.ts';
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
		history: [],
		hasProject: false,
		lastEditedTime: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}

test('buildEventsMap — task with due date enters on due date', () => {
	const task = makeTask({ dueDate: '2026-05-04' });
	const events = buildEventsMap([task], 'America/New_York');
	const day = events.get('2026-05-04');
	expect(day?.created.length).toEqual(1);
	expect(day?.created[0].id).toEqual('task-1');
});

test('buildEventsMap — task without due date falls back to created (NY)', () => {
	// 03:00 UTC May 4 → 23:00 EDT May 3
	const task = makeTask({
		created: '2026-05-04T03:00:00.000Z',
		dueDate: null
	});
	const events = buildEventsMap([task], 'America/New_York');
	expect(events.get('2026-05-03')?.created.length).toEqual(1);
	expect(events.get('2026-05-04')).toEqual(undefined);
});

test('buildEventsMap — same task buckets differently in UTC vs NY', () => {
	// 03:00 UTC = May 4 in UTC, May 3 in NY
	const task = makeTask({
		created: '2026-05-04T03:00:00.000Z',
		dueDate: null
	});
	const eventsUTC = buildEventsMap([task], 'UTC');
	const eventsNY = buildEventsMap([task], 'America/New_York');
	expect(eventsUTC.get('2026-05-04')?.created.length).toEqual(1);
	expect(eventsNY.get('2026-05-03')?.created.length).toEqual(1);
});

test('buildEventsMap — completion event fires on the completion day (no +1)', () => {
	const task = makeTask({ dueDate: '2026-05-01', completed: '2026-05-04' });
	const events = buildEventsMap([task], 'America/New_York');
	expect(events.get('2026-05-04')?.completed.length).toEqual(1);
	expect(events.get('2026-05-05')).toEqual(undefined);
});

test('buildEventsMap — task completed before due date is skipped entirely', () => {
	// due 2026-05-04, completed 2026-05-01 — was finished before it'd ever count
	const task = makeTask({ dueDate: '2026-05-04', completed: '2026-05-01' });
	const events = buildEventsMap([task], 'America/New_York');
	expect(events.size).toEqual(0);
});

test('buildEventsMap — created and completed same day produces both events on that day', () => {
	// Both events fire on the same day; the calculator nets them to zero contribution.
	const task = makeTask({ dueDate: '2026-05-04', completed: '2026-05-04' });
	const events = buildEventsMap([task], 'America/New_York');
	expect(events.get('2026-05-04')?.created.length).toEqual(1);
	expect(events.get('2026-05-04')?.completed.length).toEqual(1);
	expect(events.get('2026-05-05')).toEqual(undefined);
});

test('buildEventsMap — history entries become stateChange events', () => {
	const task = makeTask({
		dueDate: '2026-05-01',
		history: [
			{ date: '2026-05-02', tags: ['Work'], dueDate: '2026-05-01' },
			{ date: '2026-05-03', tags: ['Chore'], dueDate: '2026-05-01' }
		]
	});
	const events = buildEventsMap([task], 'America/New_York');
	expect(events.get('2026-05-02')?.stateChange.length).toEqual(1);
	expect(events.get('2026-05-03')?.stateChange.length).toEqual(1);
});

test('getMinDate — empty list returns today in tz', () => {
	const min = getMinDate([], 'America/New_York');
	// Should be a YYYY-MM-DD string
	expect(/^\d{4}-\d{2}-\d{2}$/.test(min)).toEqual(true);
});

test('getMinDate — finds earliest effective start date', () => {
	const tasks = [
		makeTask({ id: 'a', dueDate: '2026-05-04' }),
		makeTask({ id: 'b', dueDate: '2026-03-01' }),
		makeTask({ id: 'c', dueDate: '2026-04-15' })
	];
	expect(getMinDate(tasks, 'America/New_York')).toEqual('2026-03-01');
});

test('getMinDate — uses created (in tz) when no due date', () => {
	// 03:00 UTC = May 3 NY
	const tasks = [
		makeTask({
			id: 'a',
			created: '2026-05-04T03:00:00.000Z',
			dueDate: null
		}),
		makeTask({ id: 'b', dueDate: '2026-05-04' })
	];
	expect(getMinDate(tasks, 'America/New_York')).toEqual('2026-05-03');
});

test('buildEventsMap — age-band crossings appear as stateChange events', () => {
	const task = makeTask({ created: '2026-01-01T15:00:00.000Z' }); // 2026-01-01 in UTC
	const events = buildEventsMap([task], 'UTC');
	for (const date of ['2026-01-08', '2026-01-31', '2026-04-01', '2026-06-30']) {
		expect(events.get(date)?.stateChange.map((t) => t.id)).toContain('task-1');
	}
});
