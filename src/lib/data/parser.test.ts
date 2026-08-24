import { expect, test } from 'vitest';
import { parseTasks } from './parser.ts';
import type { NotionPage } from '$lib/types.js';

function makePage(overrides: Partial<NotionPage> = {}): NotionPage {
	return {
		id: 'p1',
		created_time: '2026-01-02T03:04:05.000Z',
		last_edited_time: '2026-02-03T04:05:06.000Z',
		archived: false,
		in_trash: false,
		url: '',
		properties: {
			'Date Created': { created_time: '2026-01-02T03:04:05.000Z' },
			'Completed Date': { date: null },
			'Due Date': { date: null },
			Status: { status: { name: 'Not started' } },
			Tags: { multi_select: [{ name: 'Chore', color: 'blue' }] },
			Priority: { select: { name: 'High' } },
			'Project Title': { rollup: { array: [] } }
		},
		...overrides
	};
}

test('parseTasks carries last_edited_time onto the task', () => {
	const { tasks } = parseTasks([makePage()]);
	expect(tasks[0].lastEditedTime).toEqual('2026-02-03T04:05:06.000Z');
});

test('parseTasks no longer applies base filters (cancelled tasks stay)', () => {
	const cancelled = makePage({
		id: 'p2',
		properties: { ...makePage().properties, Status: { status: { name: 'Cancelled' } } }
	});
	const { tasks } = parseTasks([makePage(), cancelled]);
	expect(tasks.length).toEqual(2);
});

test('parseTasks extracts the AI Completed checkbox', () => {
	const page = makePage({
		properties: { ...makePage().properties, 'AI Completed': { checkbox: true } }
	});
	const { tasks } = parseTasks([page, makePage({ id: 'p2' })]);
	expect(tasks[0].aiCompleted).toEqual(true);
	expect(tasks[1].aiCompleted).toEqual(false);
});
