/**
 * Legend visibility that survives chart rebuilds. The chart instance is
 * destroyed and recreated on every prop change (range, data, bucket, ...), so
 * the user's legend toggles live here instead, keyed by dataset label.
 *
 * Mutates `hidden` in place: when the category set changes (a different
 * group-by), user toggles are cleared — except `keep` labels (the 14d avg
 * line, present in every view) — and the new view's defaults are seeded.
 * Returns the categories key to pass back on the next call.
 */
export function syncHiddenLabels(
	hidden: Set<string>,
	prevKey: string | null,
	categories: string[],
	hiddenByDefault: string[],
	keep: string[] = []
): string {
	const key = categories.join('\u0000');
	if (key !== prevKey) {
		for (const label of [...hidden]) {
			if (!keep.includes(label)) hidden.delete(label);
		}
		for (const label of hiddenByDefault) hidden.add(label);
	}
	return key;
}

// Shared between TaskChart and FlowChart: both render the same category set,
// so a toggle in one mode carries over to the other.
export const hiddenLegendLabels = new Set<string>();
let prevKey: string | null = null;

export function syncLegendMemory(categories: string[], hiddenByDefault: string[]): void {
	prevKey = syncHiddenLabels(hiddenLegendLabels, prevKey, categories, hiddenByDefault, ['14d avg']);
}

/** Record a legend click; `nowHidden` = the dataset's visibility after the toggle. */
export function recordLegendToggle(label: string, nowHidden: boolean): void {
	if (nowHidden) hiddenLegendLabels.add(label);
	else hiddenLegendLabels.delete(label);
}
