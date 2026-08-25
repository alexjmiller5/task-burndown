import type { Task, TaskEvent, DayCount, GroupBy } from '$lib/types.js';
import { addDays, DEFAULT_TIMEZONE, diffDays, toLocalDateStr } from './timezone.ts';

// Band upper bounds in days; a task crosses into the next band at each limit.
export const AGE_BAND_LIMITS = [7, 30, 90, 180] as const;
const AGE_BAND_NAMES = ['<1w', '1w-1m', '1-3m', '3-6m', '6m+'] as const;
// Display order: oldest band at the bottom of the stack.
export const AGE_BAND_ORDER = [...AGE_BAND_NAMES].reverse();

// AI involvement: finished by an agent, or not. (Notion's AI Ready queue flag
// is deliberately not charted — too few tasks to read as anything but noise.)
export const AI_ORDER = ['AI Completed', 'Manual'] as const;

/**
 * The day a task starts counting: its due date when it has one, else when it
 * was created. A task completed before that (a deferred one knocked out early)
 * starts on its completion day instead, so it can't be "done before it began".
 * Everything — the chart, age bands, flows — anchors on this one date.
 */
export function getTaskStartDate(task: Task, tz: string): string {
	const start = task.dueDate ? toLocalDateStr(task.dueDate, tz) : toLocalDateStr(task.created, tz);
	const completed = task.completed ? toLocalDateStr(task.completed, tz) : null;
	return completed && completed < start ? completed : start;
}

function getAgeBand(task: Task, dateStr: string, tz: string): string {
	const age = diffDays(getTaskStartDate(task, tz), dateStr);
	for (let i = 0; i < AGE_BAND_LIMITS.length; i++) {
		if (age < AGE_BAND_LIMITS[i]) return AGE_BAND_NAMES[i];
	}
	return AGE_BAND_NAMES[AGE_BAND_NAMES.length - 1];
}

/** Group keys for a task as of a given day — shared by the chart and the flow view. */
export function getGroupKeys(task: Task, groupBy: GroupBy, dateStr: string, tz: string): string[] {
	switch (groupBy) {
		case 'tag':
			return task.tags.length > 0 ? task.tags : ['(Untagged)'];
		case 'priority':
			return [task.priority];
		case 'project':
			return [task.projectName];
		case 'age':
			return [getAgeBand(task, dateStr, tz)];
		case 'ai':
			return [task.aiCompleted ? 'AI Completed' : 'Manual'];
		default:
			throw new Error(`Unhandled groupBy: ${groupBy}`);
	}
}

interface TrackedState {
	groupKeys: string[];
	passes: boolean;
}

export interface CalculateParams {
	events: Map<string, TaskEvent>;
	minDate: string;
	limitDate: string;
	groupBy: GroupBy;
	allCategories: string[];
	selectedCategories: Set<string>;
	tz?: string;
}

export function calculateDailyCounts(params: CalculateParams): DayCount[] {
	const {
		events,
		minDate,
		limitDate,
		groupBy,
		allCategories,
		selectedCategories,
		tz = DEFAULT_TIMEZONE
	} = params;

	if (minDate >= limitDate) return [];

	const data: DayCount[] = [];
	const endDate = addDays(limitDate, 1);

	const activeStates = new Map<string, TrackedState>();
	const counts: Record<string, number> = {};
	let totalCount = 0;

	function addContribution(keys: string[]) {
		totalCount++;
		for (const key of keys) {
			counts[key] = (counts[key] || 0) + 1;
		}
	}

	function removeContribution(keys: string[]) {
		totalCount--;
		for (const key of keys) {
			counts[key] = (counts[key] || 0) - 1;
		}
	}

	function handleTaskAdd(task: Task, dateStr: string) {
		const groupKeys = getGroupKeys(task, groupBy, dateStr, tz);
		const passes = groupKeys.some((k) => selectedCategories.has(k));
		activeStates.set(task.id, { groupKeys, passes });
		if (passes) addContribution(groupKeys);
	}

	function handleTaskRemove(task: Task) {
		const state = activeStates.get(task.id);
		if (state?.passes) removeContribution(state.groupKeys);
		activeStates.delete(task.id);
	}

	function handleStateChange(task: Task, dateStr: string) {
		const oldState = activeStates.get(task.id);
		if (!oldState) return;

		const groupKeys = getGroupKeys(task, groupBy, dateStr, tz);
		const passes = groupKeys.some((k) => selectedCategories.has(k));

		if (
			oldState.passes === passes &&
			groupKeys.length === oldState.groupKeys.length &&
			groupKeys.every((k, i) => k === oldState.groupKeys[i])
		) {
			return;
		}

		if (oldState.passes) removeContribution(oldState.groupKeys);
		if (passes) addContribution(groupKeys);
		activeStates.set(task.id, { groupKeys, passes });
	}

	let dateStr = minDate;
	while (dateStr < endDate) {
		if (events.has(dateStr)) {
			const dayEvents = events.get(dateStr)!;
			for (const task of dayEvents.created) handleTaskAdd(task, dateStr);
			for (const task of dayEvents.completed) handleTaskRemove(task);
			for (const task of dayEvents.stateChange) handleStateChange(task, dateStr);
		}

		const day: DayCount = { date: dateStr, total: totalCount };
		for (const cat of allCategories) {
			day[cat] = counts[cat] || 0;
		}
		data.push(day);
		dateStr = addDays(dateStr, 1);
	}

	return data;
}
