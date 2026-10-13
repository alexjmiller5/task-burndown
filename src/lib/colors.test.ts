import { expect, test } from 'vitest';
import { FALLBACK_COLORS, getSeriesColor } from './colors.js';

// Soma's catalog option colors: the ten Notion palette names Iris renders.
const PALETTE = [
	'default',
	'gray',
	'brown',
	'orange',
	'yellow',
	'green',
	'blue',
	'purple',
	'pink',
	'red'
];

test('each of the ten palette names paints its own solid fill', () => {
	const fills = PALETTE.map((name) => getSeriesColor('tag', { tag: name }, 0));
	for (const { bg, border } of fills) {
		expect(bg).toMatch(/^#[0-9a-f]{6}$/);
		expect(border).toBe(bg);
	}
	expect(new Set(fills.map((f) => f.bg)).size).toBe(PALETTE.length);
});

test('a name outside the palette, or no color at all, takes the fallback by series index', () => {
	expect(getSeriesColor('tag', { tag: 'teal' }, 1)).toEqual(FALLBACK_COLORS[1]);
	expect(getSeriesColor('tag', {}, FALLBACK_COLORS.length)).toEqual(FALLBACK_COLORS[0]);
});

test('a #hex ramp color keeps its translucent fill and solid edge', () => {
	expect(getSeriesColor('<1w', { '<1w': '#FDE047' }, 0)).toEqual({
		bg: 'rgba(253, 224, 71, 0.55)',
		border: '#FDE047'
	});
});
