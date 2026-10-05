// Event markers on the charts. Colour follows the burndown's own good/bad
// axis: 'up' = task dump, backlog grew, red; 'down' = purge, backlog shrank,
// green (the same green AI Completed uses for "done"); 'flat' = a shaded
// neutral band from date to end (stagnation: trips, breaks). The markers are
// the user's data: they live in the app's R2 store (`markers.json`, served by
// /api/markers) and are edited in the page's marker editor, never in code.
export interface ChartMarker {
	date: string; // YYYY-MM-DD
	end?: string; // for 'flat' bands
	label: string;
	direction: 'up' | 'down' | 'flat';
}

export const MARKER_DIRECTIONS = ['up', 'down', 'flat'] as const;
export const MARKER_LABEL_MAX = 80;

function isIsoDate(v: unknown): v is string {
	if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
	return new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
}

/** Validate a stored/submitted marker list; throws on the first bad entry. */
export function parseMarkers(input: unknown): ChartMarker[] {
	if (!Array.isArray(input)) throw new Error('markers must be an array');
	return input
		.map((raw, i): ChartMarker => {
			const m = raw as Record<string, unknown>;
			const label = typeof m?.label === 'string' ? m.label.trim() : '';
			const direction = m?.direction as ChartMarker['direction'];
			if (!isIsoDate(m?.date)) throw new Error(`marker ${i}: date must be YYYY-MM-DD`);
			if (!label || label.length > MARKER_LABEL_MAX)
				throw new Error(`marker ${i}: label must be 1-${MARKER_LABEL_MAX} characters`);
			if (!MARKER_DIRECTIONS.includes(direction))
				throw new Error(`marker ${i}: direction must be up, down or flat`);
			if (direction !== 'flat') return { date: m.date as string, label, direction };
			if (!isIsoDate(m.end) || m.end < (m.date as string))
				throw new Error(`marker ${i}: a flat band needs an end on or after its date`);
			return { date: m.date as string, end: m.end, label, direction };
		})
		.sort((a, b) => a.date.localeCompare(b.date));
}

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

/**
 * Chart.js plugin drawing the event markers (time-axis buckets only):
 * vertical rules with lane-laid labels in headroom the plugin opens above the
 * data by raising y.max, plus shaded bands for 'flat' markers. Shared by
 * TaskChart and RateChart. One instance per chart — it keeps per-chart
 * relayout state, so call `reset()` on every rebuild. `getMarkers` supplies
 * the (already chip-toggled) marker list; `getDataMax` the tallest y-value
 * the label block must clear.
 */
export function createMarkerPlugin(getMarkers: () => ChartMarker[], getDataMax: () => number) {
	let laneHeadroom = 0;
	// Re-fitting the headroom costs a relayout, so cap it per rebuild — a loop
	// here would hang the page, and it settles in a pass or two.
	let laneFits = 0;
	return {
		id: 'eventMarkers',
		reset() {
			laneHeadroom = 0;
			laneFits = 0;
		},
		afterDatasetsDraw(c: any) {
			const markers = getMarkers();
			const x = c.scales.x;
			if (markers.length === 0 || !x || x.type !== 'time') return;
			const { ctx, chartArea } = c;
			const px = (d: string) => x.getPixelForValue(new Date(`${d}T12:00:00`).getTime());
			const FONT = '10px JetBrains Mono Variable';
			const GAP = 10;
			const TOP = chartArea.top + 4;

			// Backlog grew = bad = red; backlog shrank = good = green (the same green
			// AI Completed already uses for "done"). Stagnation bands stay neutral.
			// Light-400 shades: the age ramp's 1-3m band is a dark crimson (#E11D48),
			// so a mid red rule vanished into it — these separate on luminance too.
			const UP = '248, 113, 113';
			const DOWN = '74, 222, 128';
			const FLAT = '148, 163, 184';

			ctx.font = FONT;
			const placed: PlacedLabel[] = [];
			const ordered = [...markers].sort((a, b) => (a.date < b.date ? -1 : 1));

			// Pass 1: lay the labels out, so pass 2 knows how deep the block goes and
			// can start every rule below all of them rather than through one.
			const items: {
				atX: number;
				label: string;
				rgb: string;
				dashed: boolean;
				lane: number;
				left: number;
				w: number;
			}[] = [];
			for (const m of ordered) {
				const isFlat = m.direction === 'flat';
				const atX = isFlat ? Math.max(px(m.date), chartArea.left) : px(m.date);
				if (isFlat) {
					const b = Math.min(px(m.end ?? m.date), chartArea.right);
					if (b <= chartArea.left || atX >= chartArea.right) continue;
					ctx.save();
					ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
					ctx.fillRect(atX, chartArea.top, b - atX, chartArea.bottom - chartArea.top);
					ctx.restore();
				} else if (atX < chartArea.left || atX > chartArea.right) {
					continue;
				}
				const w = ctx.measureText(m.label).width;
				const left = Math.max(chartArea.left, Math.min(atX - w / 2, chartArea.right - w));
				const lane = assignLane(placed, left - GAP, left + w + GAP);
				placed.push({ lane, left: left - GAP, right: left + w + GAP });
				items.push({
					atX,
					label: m.label,
					rgb: isFlat ? FLAT : m.direction === 'up' ? UP : DOWN,
					dashed: !isFlat,
					lane,
					left,
					w
				});
			}

			const needed = laneStripHeight(placed);
			const laneY = (lane: number) => TOP + lane * MARKER_LANE_HEIGHT;

			// Pass 2: each rule runs from its own label down to the axis, broken
			// around any lower label it would otherwise strike through.
			for (const it of items) {
				const gaps = items
					.filter((o) => o.lane > it.lane && it.atX >= o.left - 2 && it.atX <= o.left + o.w + 2)
					.map((o) => [laneY(o.lane) - 2, laneY(o.lane) + MARKER_LANE_HEIGHT - 1])
					.sort((a, b) => a[0] - b[0]);

				ctx.save();
				ctx.strokeStyle = `rgba(${it.rgb}, 0.65)`;
				ctx.lineWidth = 1;
				if (it.dashed) ctx.setLineDash([4, 4]);
				ctx.beginPath();
				let y = laneY(it.lane) + MARKER_LANE_HEIGHT - 2;
				for (const [gapStart, gapEnd] of gaps) {
					if (gapEnd <= y) continue;
					if (gapStart > y) {
						ctx.moveTo(it.atX, y);
						ctx.lineTo(it.atX, gapStart);
					}
					y = Math.max(y, gapEnd);
				}
				ctx.moveTo(it.atX, y);
				ctx.lineTo(it.atX, chartArea.bottom);
				ctx.stroke();
				ctx.restore();
			}

			// Labels last, so no rule can be drawn over their text.
			for (const it of items) {
				ctx.save();
				ctx.fillStyle = `rgb(${it.rgb})`;
				ctx.font = FONT;
				ctx.textBaseline = 'top';
				ctx.fillText(it.label, it.left, laneY(it.lane));
				ctx.restore();
			}

			// Open headroom above the tallest data point by raising the axis max,
			// so the labels sit on empty chart rather than on the data. Solves for
			// max' with the axis min taken into account (RateChart's axis goes
			// negative; TaskChart's starts at 0).
			const want = needed + 10;
			const H = chartArea.bottom - chartArea.top;
			const dataMax = getDataMax();
			const min = Math.min(0, c.scales.y.min ?? 0);
			if (dataMax > 0 && H > want + 20) {
				// Round up to a clean tick, else the axis tops out on something like
				// 843 and crowds the tick below it. Also keeps the refit stable.
				const raw = (dataMax * H - min * want) / (H - want);
				const step = raw >= 200 ? 100 : raw >= 50 ? 20 : 10;
				const target = Math.ceil(raw / step) * step;
				if (Math.abs(target - laneHeadroom) > 1 && laneFits < 3) {
					laneHeadroom = target;
					laneFits++;
					c.options.scales.y.max = target;
					requestAnimationFrame(() => c.update('none'));
				}
			}
		}
	};
}
