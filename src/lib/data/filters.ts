import type { Task } from '$lib/types.js';
import dayjs from 'dayjs';

const LEGACY_CUTOFF = '2025-01-10';

export type ProjectKind = 'project' | 'none';
export const PROJECT_KINDS: readonly ProjectKind[] = ['project', 'none'];

export interface FilterOptions {
	/** Which tasks count: with a project, without, or both. */
	projectKinds: readonly ProjectKind[];
}

/** Remove tasks that should never be shown; canceled ones only when toggled in. */
export function applyBaseFilters(tasks: Task[], includeCanceled = false): Task[] {
	return tasks.filter((task) => {
		if (!task.created) return false;
		if (!includeCanceled && (task.status === 'Cancelled' || task.status === 'Canceled'))
			return false;
		if (task.tags.includes('useless')) return false;
		return true;
	});
}

/** Client-side: legacy cutoff plus the project lens. */
export function applyViewFilters(tasks: Task[], options: FilterOptions): Task[] {
	return tasks.filter((task) => {
		if (!dayjs(task.created).isAfter(LEGACY_CUTOFF)) return false;
		return options.projectKinds.includes(task.hasProject ? 'project' : 'none');
	});
}
