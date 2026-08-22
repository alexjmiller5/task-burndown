import { expect, test } from 'vitest';
import { getIncrementalSince, mergeParsedData, pruneDeletedTasks } from './merge.ts';
import type { ParsedData, Task } from '$lib/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: 't1',
		created: '2026-01-01T00:00:00.000Z',
		completed: null,
		dueDate: null,
		status: 'Not started',
		tags: [],
		priority: '(No Priority)',
		projectName: '(No Project)',
		aiReady: false,
		aiCompleted: false,
		hasProject: false,
		lastEditedTime: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}
function makeParsed(overrides: Partial<ParsedData> = {}): ParsedData {
	return {
		tasks: [],
		allTags: [],
		allPriorities: [],
		allProjects: [],
		tagColors: {},
		...overrides
	};
}

test('mergeParsedData: fresh task replaces cached task with same id', () => {
	const base = makeParsed({ tasks: [makeTask({ status: 'Not started' })] });
	const fresh = makeParsed({ tasks: [makeTask({ status: 'Done' })] });
	const merged = mergeParsedData(base, fresh);
	expect(merged.tasks.length).toEqual(1);
	expect(merged.tasks[0].status).toEqual('Done');
});

test('mergeParsedData: unions metadata', () => {
	const base = makeParsed({
		allTags: ['Chore'],
		allPriorities: ['High'],
		allProjects: ['A'],
		tagColors: { Chore: 'blue' }
	});
	const fresh = makeParsed({
		allTags: ['Work'],
		allPriorities: ['Low'],
		allProjects: ['B'],
		tagColors: { Work: 'red' }
	});
	const merged = mergeParsedData(base, fresh);
	expect(merged.allTags).toEqual(['Chore', 'Work']);
	expect(merged.allPriorities).toEqual(['High', 'Low']);
	expect(merged.allProjects).toEqual(['A', 'B']);
	expect(merged.tagColors).toEqual({ Chore: 'blue', Work: 'red' });
});

test('getIncrementalSince: earlier of the two maxima', () => {
	const tasks = [
		makeTask({
			id: 'a',
			created: '2026-01-05T00:00:00.000Z',
			lastEditedTime: '2026-01-06T00:00:00.000Z'
		}),
		makeTask({
			id: 'b',
			created: '2026-01-01T00:00:00.000Z',
			lastEditedTime: '2026-01-09T00:00:00.000Z'
		})
	];
	// max(created)=01-05, max(edited)=01-09 -> earlier is 01-05
	expect(getIncrementalSince(tasks)).toEqual('2026-01-05T00:00:00.000Z');
});

test('getIncrementalSince: null for empty', () => {
	expect(getIncrementalSince([])).toEqual(null);
});

const CUTOFF = '2026-04-01T00:00:00.000Z';

test('pruneDeletedTasks: drops sweep-eligible tasks missing from the swept id set', () => {
	const tasks = [
		makeTask({ id: 'a', created: '2026-05-01T00:00:00.000Z' }),
		makeTask({ id: 'b', created: '2026-05-01T00:00:00.000Z' }),
		makeTask({ id: 'c', created: '2026-05-01T00:00:00.000Z' })
	];
	expect(pruneDeletedTasks(tasks, new Set(['a', 'c']), CUTOFF).map((t) => t.id)).toEqual([
		'a',
		'c'
	]);
});

test('pruneDeletedTasks: keeps tasks outside the sweep heuristic (old, settled, not to-do)', () => {
	const old = makeTask({
		id: 'old',
		created: '2025-01-01T00:00:00.000Z',
		lastEditedTime: '2025-01-02T00:00:00.000Z',
		status: 'Completed'
	});
	expect(pruneDeletedTasks([old], new Set(), CUTOFF)).toEqual([old]);
});

test('pruneDeletedTasks: recently edited or To Do/In Progress tasks are sweep-eligible', () => {
	const editedRecently = makeTask({
		id: 'e',
		created: '2025-01-01T00:00:00.000Z',
		lastEditedTime: '2026-05-01T00:00:00.000Z',
		status: 'Completed'
	});
	const oldTodo = makeTask({
		id: 't',
		created: '2025-01-01T00:00:00.000Z',
		lastEditedTime: '2025-01-02T00:00:00.000Z',
		status: 'To Do'
	});
	const oldInProgress = makeTask({
		id: 'p',
		created: '2025-01-01T00:00:00.000Z',
		lastEditedTime: '2025-01-02T00:00:00.000Z',
		status: 'In Progress'
	});
	// none of them were returned by the sweep -> all deleted
	expect(pruneDeletedTasks([editedRecently, oldTodo, oldInProgress], new Set(), CUTOFF)).toEqual(
		[]
	);
});
