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

/** A marker label already drawn: a narrow vertical strip at `x`, spanning `top`..`bottom`. */
export interface PlacedLabel {
	x: number;
	top: number;
	bottom: number;
}

/**
 * Marker labels are rotated 90°, so each is a narrow vertical strip. Two only
 * collide when their x strips overlap AND their y ranges do — markers a week
 * apart never clash, markers a day apart always do. Push the newcomer below
 * anything it would sit on top of and return the y to start drawing at.
 */
export function placeLabel(
	placed: PlacedLabel[],
	x: number,
	length: number,
	top: number,
	bottom: number,
	xGap = 14,
	yGap = 6
): number {
	let y = top;
	// Re-scan after each push: moving down can land on a different label.
	for (let guard = 0; guard <= placed.length; guard++) {
		const hit = placed.find((p) => Math.abs(p.x - x) < xGap && y < p.bottom && y + length > p.top);
		if (!hit) break;
		y = hit.bottom + yGap;
	}
	// Never run off the bottom of the plot; better to overlap than to vanish.
	return y + length > bottom ? top : y;
}
