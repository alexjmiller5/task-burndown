import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings.ts';

test('the default day starts at midnight', () => {
	expect(DEFAULT_SETTINGS).toEqual({ dayStartMinutes: 0 });
});

test.each([0, 180, 1439])('accepts a day start of %i minutes', (dayStartMinutes) => {
	expect(parseSettings({ dayStartMinutes })).toEqual({ dayStartMinutes });
});

test.each([[-1], [1440], [90.5], ['180'], [null], [Number.NaN]])(
	'rejects a day start of %s',
	(dayStartMinutes) => {
		expect(() => parseSettings({ dayStartMinutes })).toThrow(/dayStartMinutes/);
	}
);

test.each([[null], [[]], ['x'], [{}]])('rejects a non-settings body %j', (input) => {
	expect(() => parseSettings(input)).toThrow();
});
