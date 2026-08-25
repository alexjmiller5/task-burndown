// Manual event markers on the Active chart (day/week buckets). Colour follows
// the burndown's own good/bad axis: 'up' = task dump, backlog grew, red;
// 'down' = purge, backlog shrank, green (the same green AI Completed uses for
// "done"); 'flat' = a shaded neutral band from date to end (stagnation: trips,
// breaks). The Markers chip toggles all of them.
export interface ChartMarker {
	date: string; // YYYY-MM-DD
	end?: string; // for 'flat' bands
	label: string;
	direction: 'up' | 'down' | 'flat';
}

export const MARKERS: ChartMarker[] = [];

/** Marker labels live in horizontal lanes in the headroom above the bars. */
export interface PlacedLabel {
	lane: number;
	left: number;
	right: number;
}

export const MARKER_LANE_HEIGHT = 13;
export const MARKER_MAX_LANES = 6;

/**
 * Drop a label into the highest lane it fits in. Markers far enough apart
 * share the top lane; ones that would run into each other stack downward.
 * Past `maxLanes` we give up and reuse the last lane rather than pushing the
 * headroom taller than the chart can spare.
 */
export function assignLane(
	placed: PlacedLabel[],
	left: number,
	right: number,
	maxLanes = MARKER_MAX_LANES
): number {
	for (let lane = 0; lane < maxLanes; lane++) {
		const clash = placed.some((p) => p.lane === lane && left < p.right && right > p.left);
		if (!clash) return lane;
	}
	return maxLanes - 1;
}

/** Height of headroom needed to hold everything placed so far. */
export function laneStripHeight(placed: PlacedLabel[]): number {
	if (placed.length === 0) return 0;
	const lanes = Math.max(...placed.map((p) => p.lane)) + 1;
	return lanes * MARKER_LANE_HEIGHT + 6;
}
