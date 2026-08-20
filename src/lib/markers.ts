// Manual event markers on the Active chart (day/week buckets). Directions:
// 'up' = blue dashed line (task dump, like Created), 'down' = green dashed
// line (purge, like Completed), 'flat' = shaded band from date to end
// (stagnation: trips, breaks). The Markers chip toggles all of them.
export interface ChartMarker {
	date: string; // YYYY-MM-DD
	end?: string; // for 'flat' bands
	label: string;
	direction: 'up' | 'down' | 'flat';
}

export const MARKERS: ChartMarker[] = [];
