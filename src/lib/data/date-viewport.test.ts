import { expect, test } from 'vitest';
import { dayNumber, dateString, dateViewport, panViewport, moveSelection } from './date-viewport';

const bounds = { start: '2020-01-01', end: '2026-10-20' };
test('recent viewport stays small even with an ALL selection', () => {
	expect(dateViewport(bounds.start, bounds.end, '2026-10-06')).toEqual({
		start: '2026-07-08',
		end: '2026-10-06'
	});
	expect(dateViewport('2026-10-01', '2026-10-06', '2026-10-06')).toEqual({
		start: '2026-10-01',
		end: '2026-10-06'
	});
});
test('panning preserves width and stops at archive boundaries', () => {
	const view = { start: '2026-07-08', end: '2026-10-06' };
	expect(panViewport(view, -30, bounds.start, bounds.end)).toEqual({
		start: '2026-06-08',
		end: '2026-09-06'
	});
	expect(panViewport(view, 30, bounds.start, bounds.end)).toEqual({
		start: '2026-07-22',
		end: '2026-10-20'
	});
	expect(panViewport(view, -9999, bounds.start, bounds.end)).toEqual({
		start: '2020-01-01',
		end: '2020-03-31'
	});
});
test('calendar offsets cross daylight saving boundaries without duplicating a date', () => {
	expect(dateString(dayNumber('2026-03-07') + 3)).toBe('2026-03-10');
	expect(dayNumber('2026-11-03') - dayNumber('2026-10-31')).toBe(3);
});
test('whole-window movement keeps its duration at both bounds', () => {
	expect(
		moveSelection({ start: '2026-07-08', end: '2026-10-06' }, 99, bounds.start, bounds.end)
	).toEqual({ start: '2026-07-22', end: '2026-10-20' });
	expect(
		moveSelection({ start: '2020-01-01', end: '2026-10-20' }, -30, bounds.start, bounds.end)
	).toEqual(bounds);
});
