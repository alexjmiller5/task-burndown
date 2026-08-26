import type { GroupBy } from '$lib/types.js';

/**
 * Legend visibility that survives chart rebuilds AND persists. The chart
 * instance is destroyed and recreated on every prop change (range, data,
 * bucket, ...), so the user's legend toggles live here instead, keyed by
 * dataset label. Each group-by keeps its own hidden set, saved to
 * localStorage, so hiding e.g. High in the priority breakdown survives both
 * switching breakdowns and page reloads — same as the filter chips.
 */
export const STORAGE_KEY = 'burndown:legend:v1';

/**
 * Pure core (unit-tested). Mutates `hidden` in place: when `group` differs
 * from `prevGroup`, swaps in that group's stored set — seeding
 * `hiddenByDefault` only on the group's first-ever visit — and writes the
 * result back to `store`. `keep` labels (the 14d avg line, present in every
 * view) carry their current on/off state across the switch.
 */
export function syncHiddenGroup(
	store: Record<string, string[]>,
	hidden: Set<string>,
	prevGroup: string | null,
	group: string,
	hiddenByDefault: string[],
	keep: string[] = []
): void {
	if (group === prevGroup) return;
	// prevGroup === null means first build (page load): the stored set already
	// holds the keep-labels' last persisted state, so nothing to carry over.
	const kept = prevGroup === null ? null : keep.filter((label) => hidden.has(label));
	hidden.clear();
	for (const label of store[group] ?? hiddenByDefault) hidden.add(label);
	if (kept !== null) {
		for (const label of keep) hidden.delete(label);
		for (const label of kept) hidden.add(label);
	}
	store[group] = [...hidden];
}

function readStore(): Record<string, string[]> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '');
		if (
			typeof parsed === 'object' &&
			parsed !== null &&
			Object.values(parsed).every(
				(v) => Array.isArray(v) && v.every((label) => typeof label === 'string')
			)
		) {
			return parsed as Record<string, string[]>;
		}
	} catch {
		// missing/corrupt storage (or SSR) falls back to empty
	}
	return {};
}

function writeStore(): void {
	if (!store) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
	} catch {
		// storage unavailable — toggles still work in-memory for the session
	}
}

// Shared between TaskChart and FlowChart: both render the same category set,
// so a toggle in one mode carries over to the other.
export const hiddenLegendLabels = new Set<string>();
let store: Record<string, string[]> | null = null;
let currentGroup: string | null = null;

export function syncLegendMemory(group: GroupBy, hiddenByDefault: string[]): void {
	store ??= readStore();
	if (group === currentGroup) return;
	syncHiddenGroup(store, hiddenLegendLabels, currentGroup, group, hiddenByDefault, ['14d avg']);
	currentGroup = group;
	writeStore();
}

/** Record a legend click; `nowHidden` = the dataset's visibility after the toggle. */
export function recordLegendToggle(label: string, nowHidden: boolean): void {
	if (nowHidden) hiddenLegendLabels.add(label);
	else hiddenLegendLabels.delete(label);
	if (store && currentGroup !== null) {
		store[currentGroup] = [...hiddenLegendLabels];
		writeStore();
	}
}
