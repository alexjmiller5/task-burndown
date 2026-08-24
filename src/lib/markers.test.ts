import { describe, it, expect } from 'vitest';
import { placeLabel, MARKERS, type PlacedLabel } from './markers.js';

const TOP = 10;
const BOTTOM = 400;

describe('placeLabel', () => {
	it('puts the first label at the top', () => {
		expect(placeLabel([], 100, 50, TOP, BOTTOM)).toBe(TOP);
	});

	it('leaves labels alone when they are far apart horizontally', () => {
		const placed: PlacedLabel[] = [{ x: 100, top: TOP, bottom: TOP + 50 }];
		expect(placeLabel(placed, 300, 50, TOP, BOTTOM)).toBe(TOP);
	});

	it('pushes a near-neighbour below the label it would cover', () => {
		const placed: PlacedLabel[] = [{ x: 100, top: TOP, bottom: TOP + 50 }];
		// 4px apart: strips overlap, so it has to move down
		expect(placeLabel(placed, 104, 50, TOP, BOTTOM)).toBe(TOP + 50 + 6);
	});

	it('stacks a third label below the first two', () => {
		const placed: PlacedLabel[] = [];
		for (const x of [100, 103, 106]) {
			const y = placeLabel(placed, x, 40, TOP, BOTTOM);
			placed.push({ x, top: y, bottom: y + 40 });
		}
		expect(placed.map((p) => p.top)).toEqual([TOP, TOP + 46, TOP + 92]);
	});

	it('reuses the top lane once a label is clear of the previous one', () => {
		const placed: PlacedLabel[] = [{ x: 100, top: TOP, bottom: TOP + 50 }];
		// same column, but starts below where the first one ends
		expect(placeLabel(placed, 100, 50, TOP + 80, BOTTOM)).toBe(TOP + 80);
	});

	it('falls back to the top rather than drawing past the bottom', () => {
		const placed: PlacedLabel[] = [{ x: 100, top: TOP, bottom: 380 }];
		expect(placeLabel(placed, 100, 50, TOP, BOTTOM)).toBe(TOP);
	});

	it('terminates on a dense cluster and never overlaps', () => {
		const placed: PlacedLabel[] = [];
		for (let i = 0; i < 8; i++) {
			const x = 100 + i; // all within xGap of each other
			const y = placeLabel(placed, x, 20, TOP, BOTTOM);
			placed.push({ x, top: y, bottom: y + 20 });
		}
		for (let i = 0; i < placed.length; i++) {
			for (let j = i + 1; j < placed.length; j++) {
				const a = placed[i];
				const b = placed[j];
				const overlaps = Math.abs(a.x - b.x) < 14 && a.top < b.bottom && a.bottom > b.top;
				expect(overlaps).toBe(false);
			}
		}
	});
});

describe('MARKERS data', () => {
	it('every marker has an ISO date and a label', () => {
		for (const m of MARKERS) {
			expect(m.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(m.label.length).toBeGreaterThan(0);
		}
	});

	it('flat bands end on or after they start', () => {
		for (const m of MARKERS.filter((m) => m.direction === 'flat')) {
			expect(m.end).toBeDefined();
			expect(m.end! >= m.date).toBe(true);
		}
	});
});
