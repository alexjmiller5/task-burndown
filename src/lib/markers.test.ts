import { describe, it, expect } from 'vitest';
import {
	assignLane,
	laneStripHeight,
	MARKER_LANE_HEIGHT,
	parseMarkers,
	type PlacedLabel
} from './markers.js';

describe('assignLane', () => {
	it('puts the first label in the top lane', () => {
		expect(assignLane([], 100, 200)).toBe(0);
	});

	it('keeps well-separated labels in the top lane', () => {
		const placed: PlacedLabel[] = [{ lane: 0, left: 100, right: 200 }];
		expect(assignLane(placed, 300, 400)).toBe(0);
	});

	it('drops an overlapping label into the next lane', () => {
		const placed: PlacedLabel[] = [{ lane: 0, left: 100, right: 200 }];
		expect(assignLane(placed, 150, 250)).toBe(1);
	});

	it('treats touching edges as clear', () => {
		const placed: PlacedLabel[] = [{ lane: 0, left: 100, right: 200 }];
		expect(assignLane(placed, 200, 300)).toBe(0);
	});

	it('reuses lane 0 once a later label clears the one before it', () => {
		const placed: PlacedLabel[] = [
			{ lane: 0, left: 100, right: 200 },
			{ lane: 1, left: 150, right: 250 }
		];
		expect(assignLane(placed, 260, 360)).toBe(0);
	});

	it('stacks a pile-up into successive lanes', () => {
		const placed: PlacedLabel[] = [];
		for (let i = 0; i < 4; i++) {
			const left = 100 + i * 10;
			const lane = assignLane(placed, left, left + 100);
			placed.push({ lane, left, right: left + 100 });
		}
		expect(placed.map((p) => p.lane)).toEqual([0, 1, 2, 3]);
	});

	it('never overlaps two labels sharing a lane', () => {
		const placed: PlacedLabel[] = [];
		for (let i = 0; i < 12; i++) {
			const left = 100 + i * 17;
			const lane = assignLane(placed, left, left + 100);
			placed.push({ lane, left, right: left + 100 });
		}
		for (let i = 0; i < placed.length; i++) {
			for (let j = i + 1; j < placed.length; j++) {
				const a = placed[i];
				const b = placed[j];
				if (a.lane !== b.lane) continue;
				expect(a.left < b.right && a.right > b.left).toBe(false);
			}
		}
	});

	it('reuses the last lane rather than growing past maxLanes', () => {
		const placed: PlacedLabel[] = [0, 1, 2].map((lane) => ({ lane, left: 100, right: 200 }));
		expect(assignLane(placed, 100, 200, 3)).toBe(2);
	});
});

describe('laneStripHeight', () => {
	it('reserves nothing when there are no markers', () => {
		expect(laneStripHeight([])).toBe(0);
	});

	it('grows with the deepest lane used, not the label count', () => {
		const one: PlacedLabel[] = [{ lane: 0, left: 0, right: 10 }];
		const many: PlacedLabel[] = [
			{ lane: 0, left: 0, right: 10 },
			{ lane: 0, left: 20, right: 30 },
			{ lane: 2, left: 5, right: 15 }
		];
		expect(laneStripHeight(one)).toBe(MARKER_LANE_HEIGHT + 6);
		expect(laneStripHeight(many)).toBe(3 * MARKER_LANE_HEIGHT + 6);
	});
});

describe('parseMarkers', () => {
	it('accepts line markers and flat bands, sorted by date', () => {
		expect(
			parseMarkers([
				{ date: '2026-03-01', label: 'B', direction: 'down' },
				{ date: '2026-01-05', end: '2026-01-09', label: 'A', direction: 'flat' }
			])
		).toEqual([
			{ date: '2026-01-05', end: '2026-01-09', label: 'A', direction: 'flat' },
			{ date: '2026-03-01', label: 'B', direction: 'down' }
		]);
	});

	it('trims labels and drops an end on line markers', () => {
		expect(
			parseMarkers([{ date: '2026-03-01', end: '2026-03-02', label: ' B ', direction: 'up' }])
		).toEqual([{ date: '2026-03-01', label: 'B', direction: 'up' }]);
	});

	it.each([
		['a non-array', { date: '2026-03-01' }],
		['a bad date', [{ date: '2026-3-1', label: 'x', direction: 'up' }]],
		['an impossible date', [{ date: '2026-02-30', label: 'x', direction: 'up' }]],
		['an empty label', [{ date: '2026-03-01', label: '  ', direction: 'up' }]],
		['an unknown direction', [{ date: '2026-03-01', label: 'x', direction: 'left' }]],
		['a flat band without an end', [{ date: '2026-03-01', label: 'x', direction: 'flat' }]],
		[
			'a flat band ending before it starts',
			[{ date: '2026-03-05', end: '2026-03-01', label: 'x', direction: 'flat' }]
		],
		['an over-long label', [{ date: '2026-03-01', label: 'x'.repeat(81), direction: 'up' }]]
	])('rejects %s', (_, input) => {
		expect(() => parseMarkers(input)).toThrow();
	});
});
