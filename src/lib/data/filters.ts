import type { Task } from '$lib/types.js';
import dayjs from 'dayjs';
import { getTaskStartDate } from './calculator.ts';
import { toLocalDateStr } from './timezone.ts';

const LEGACY_CUTOFF = '2025-01-10';

export type ProjectKind = 'project' | 'none';
export type SameDayKind = 'same' | 'other';

export const PROJECT_KINDS: readonly ProjectKind[] = ['project', 'none'];
export const SAME_DAY_KINDS: readonly SameDayKind[] = ['same', 'other'];
/** Statuses hidden until the status lens toggles them in. */
export const DEFAULT_HIDDEN_STATUSES = ['Canceled', 'Cancelled'];

export interface FilterOptions {
	hiddenStatuses: string[];
	projectKinds: readonly ProjectKind[];
	sameDayKinds: readonly SameDayKind[];
	tz: string;
}

/** Remove tasks that should never be shown. */
export function applyBaseFilters(tasks: Task[]): Task[] {
	return tasks.filter((task) => !!task.created && !task.tags.includes('useless'));
}

/** A same-day task: its effective start is the day it was completed. */
export function isSameDay(task: Task, tz: string): boolean {
	return !!task.completed && toLocalDateStr(task.completed, tz) === getTaskStartDate(task, tz);
}

/** Client-side: apply the user's lenses (status, project, same-day). */
export function applyViewFilters(tasks: Task[], options: FilterOptions): Task[] {
	const hidden = new Set(options.hiddenStatuses);
	return tasks.filter((task) => {
		if (!dayjs(task.created).isAfter(LEGACY_CUTOFF)) return false;
		if (hidden.has(task.status)) return false;
		if (!options.projectKinds.includes(task.hasProject ? 'project' : 'none')) return false;
		if (!options.sameDayKinds.includes(isSameDay(task, options.tz) ? 'same' : 'other'))
			return false;
		return true;
	});
}
