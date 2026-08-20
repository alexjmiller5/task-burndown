// Manual event markers drawn as vertical lines on the Active chart (day/week
// buckets). Add a row for any real-life event that explains an uptick (task
// dump) or downtick (purge) in the task count; direction picks the color
// (up = blue, like Created; down = green, like Completed).
export interface ChartMarker {
	date: string; // YYYY-MM-DD
	label: string;
	direction: 'up' | 'down';
}

export const MARKERS: ChartMarker[] = [];
