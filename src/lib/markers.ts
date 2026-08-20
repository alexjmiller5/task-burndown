// Manual event markers drawn as vertical lines on the Active chart (day/week
// buckets). Add a row here for any real-life event that explains an uptick or
// downtick in the task count.
export interface ChartMarker {
	date: string; // YYYY-MM-DD
	label: string;
}

export const MARKERS: ChartMarker[] = [];
