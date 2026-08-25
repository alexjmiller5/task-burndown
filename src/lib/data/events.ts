import type { Task, TaskEvent } from '$lib/types.js';
import { AGE_BAND_LIMITS, getTaskStartDate } from './calculator.ts';
import { addDays, getCurrentDateStr, toLocalDateStr } from './timezone.ts';

export function buildEventsMap(tasks: Task[], tz: string): Map<string, TaskEvent> {
	const events = new Map<string, TaskEvent>();

	function addEvent(dateStr: string, type: keyof TaskEvent, task: Task) {
		if (!events.has(dateStr)) {
			events.set(dateStr, { created: [], completed: [], stateChange: [] });
		}
		events.get(dateStr)![type].push(task);
	}

	for (const task of tasks) {
		const startDate = getTaskStartDate(task, tz);
		const completedDate = task.completed ? toLocalDateStr(task.completed, tz) : null;

		addEvent(startDate, 'created', task);

		if (completedDate) {
			addEvent(completedDate, 'completed', task);
		}

		// Age-band crossings: the task's group changes on these days even without
		// an edit. Harmless for other group-bys (unchanged keys are a no-op).
		for (const limit of AGE_BAND_LIMITS) {
			const crossing = addDays(startDate, limit);
			if (completedDate && crossing > completedDate) break;
			addEvent(crossing, 'stateChange', task);
		}
	}

	return events;
}

export function getMinDate(tasks: Task[], tz: string): string {
	if (tasks.length === 0) return getCurrentDateStr(tz);

	let min = getTaskStartDate(tasks[0], tz);
	for (const task of tasks) {
		const start = getTaskStartDate(task, tz);
		if (start < min) min = start;
	}

	return min;
}
