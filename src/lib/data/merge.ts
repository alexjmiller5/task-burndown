import type { ParsedData, Task } from '$lib/types.js';
import { PRIORITY_ORDER } from './parser.js';

export function mergeParsedData(base: ParsedData, fresh: ParsedData): ParsedData {
	const byId = new Map<string, Task>();
	for (const t of base.tasks) byId.set(t.id, t);
	for (const t of fresh.tasks) byId.set(t.id, t);
	return {
		tasks: [...byId.values()],
		allTags: [...new Set([...base.allTags, ...fresh.allTags])].sort(),
		allPriorities: PRIORITY_ORDER.filter(
			(p) => base.allPriorities.includes(p) || fresh.allPriorities.includes(p)
		),
		allProjects: [...new Set([...base.allProjects, ...fresh.allProjects])].sort(),
		tagColors: { ...base.tagColors, ...fresh.tagColors }
	};
}

export const PRUNE_WINDOW_DAYS = 90;

/** Cutoff for the deletion-sweep heuristic: 3 months before now. */
export function getPruneCutoff(now: Date = new Date()): string {
	return new Date(now.getTime() - PRUNE_WINDOW_DAYS * 86_400_000).toISOString();
}

/**
 * A task the sweep is expected to have returned if it still exists: created or
 * edited within the window, or still open. Anything else is assumed immutable
 * (and thus un-deletable without a full sync — accepted tradeoff).
 */
function isSweepEligible(t: Task, cutoff: string): boolean {
	return (
		t.created >= cutoff ||
		t.lastEditedTime >= cutoff ||
		t.status === 'To Do' ||
		t.status === 'In Progress'
	);
}

/** Deletion sweep: drop sweep-eligible tasks whose id no longer exists in Notion. */
export function pruneDeletedTasks(tasks: Task[], sweptIds: Set<string>, cutoff: string): Task[] {
	return tasks.filter((t) => sweptIds.has(t.id) || !isSweepEligible(t, cutoff));
}

/** Earlier of max(created) / max(lastEditedTime) — mirrors the old page-based threshold. */
export function getIncrementalSince(tasks: Task[]): string | null {
	if (tasks.length === 0) return null;
	let maxCreated = '';
	let maxEdited = '';
	for (const t of tasks) {
		if (t.created > maxCreated) maxCreated = t.created;
		if (t.lastEditedTime > maxEdited) maxEdited = t.lastEditedTime;
	}
	return maxCreated < maxEdited ? maxCreated : maxEdited;
}
