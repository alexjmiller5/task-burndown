import { expect, test } from 'vitest';
import {
	addDays,
	DEVICE_TIMEZONE,
	diffDays,
	getCurrentDateStr,
	TIMEZONES,
	toLocalDateStr
} from './timezone.ts';

test('toLocalDateStr — date-only strings pass through unchanged', () => {
	expect(toLocalDateStr('2026-05-04', 'America/New_York')).toEqual('2026-05-04');
	expect(toLocalDateStr('2026-05-04', 'UTC')).toEqual('2026-05-04');
	expect(toLocalDateStr('2026-12-31', 'America/Los_Angeles')).toEqual('2026-12-31');
});

test('toLocalDateStr — UTC ISO converts to NY date (afternoon UTC stays same NY day)', () => {
	// 18:00 UTC = 14:00 EDT (May = EDT, UTC-4)
	expect(toLocalDateStr('2026-05-04T18:00:00.000Z', 'America/New_York')).toEqual('2026-05-04');
});

test('toLocalDateStr — UTC ISO converts to NY date (early morning UTC = previous NY day)', () => {
	// 03:00 UTC May 4 = 23:00 EDT May 3
	expect(toLocalDateStr('2026-05-04T03:00:00.000Z', 'America/New_York')).toEqual('2026-05-03');
});

test('toLocalDateStr — UTC ISO with UTC tz returns the UTC date', () => {
	expect(toLocalDateStr('2026-05-04T03:00:00.000Z', 'UTC')).toEqual('2026-05-04');
});

test('toLocalDateStr — UTC ISO converts to LA date', () => {
	// 06:00 UTC May 4 = 23:00 PDT May 3
	expect(toLocalDateStr('2026-05-04T06:00:00.000Z', 'America/Los_Angeles')).toEqual('2026-05-03');
});

test('toLocalDateStr — winter (EST = UTC-5), 04:00 UTC = previous day', () => {
	// January = EST (UTC-5). 04:00 UTC Jan 15 = 23:00 EST Jan 14
	expect(toLocalDateStr('2026-01-15T04:00:00.000Z', 'America/New_York')).toEqual('2026-01-14');
});

test('addDays — simple +1', () => {
	expect(addDays('2026-05-04', 1)).toEqual('2026-05-05');
});

test('addDays — simple -1', () => {
	expect(addDays('2026-05-04', -1)).toEqual('2026-05-03');
});

test('addDays — across spring DST (US, March 8 2026)', () => {
	// Should produce calendar-day arithmetic regardless of DST
	expect(addDays('2026-03-08', 1)).toEqual('2026-03-09');
	expect(addDays('2026-03-07', 2)).toEqual('2026-03-09');
});

test('addDays — across fall DST (US, Nov 1 2026)', () => {
	expect(addDays('2026-11-01', 1)).toEqual('2026-11-02');
});

test('addDays — month boundary', () => {
	expect(addDays('2026-01-31', 1)).toEqual('2026-02-01');
});

test('addDays — year boundary', () => {
	expect(addDays('2026-12-31', 1)).toEqual('2027-01-01');
	expect(addDays('2026-01-01', -1)).toEqual('2025-12-31');
});

test('addDays — leap year (2024-02-28 + 1)', () => {
	expect(addDays('2024-02-28', 1)).toEqual('2024-02-29');
	expect(addDays('2024-02-29', 1)).toEqual('2024-03-01');
});

test('addDays — non-leap-year (2026-02-28 + 1)', () => {
	expect(addDays('2026-02-28', 1)).toEqual('2026-03-01');
});

test('addDays — zero days returns same date', () => {
	expect(addDays('2026-05-04', 0)).toEqual('2026-05-04');
});

test('addDays — large step', () => {
	expect(addDays('2026-01-01', 365)).toEqual('2027-01-01');
});

test('getCurrentDateStr — returns YYYY-MM-DD format using injected now', () => {
	const fakeNow = new Date('2026-05-04T18:00:00.000Z'); // 14:00 EDT
	expect(getCurrentDateStr('America/New_York', fakeNow)).toEqual('2026-05-04');
	expect(getCurrentDateStr('UTC', fakeNow)).toEqual('2026-05-04');
});

test('getCurrentDateStr — early UTC = previous local day in NY', () => {
	const fakeNow = new Date('2026-05-04T03:00:00.000Z'); // 23:00 EDT May 3
	expect(getCurrentDateStr('America/New_York', fakeNow)).toEqual('2026-05-03');
});

test('TIMEZONES — curated list contains expected entries', () => {
	const ids = TIMEZONES.map((t) => t.id);
	for (const expected of [
		'America/New_York',
		'America/Chicago',
		'America/Denver',
		'America/Los_Angeles',
		'UTC',
		'Europe/London'
	]) {
		expect(ids.includes(expected)).toEqual(true);
	}
});

test('DEVICE_TIMEZONE is a picker value, not a fixed zone', () => {
	expect(TIMEZONES.map((t) => t.id)).not.toContain(DEVICE_TIMEZONE);
	expect(() => new Intl.DateTimeFormat('en', { timeZone: DEVICE_TIMEZONE })).toThrow();
});

// Day boundary at 03:00 in New York: a 02:59 instant still belongs to yesterday.
const NY3 = { tz: 'America/New_York', dayStart: 180 };

test('getCurrentDateStr - before the day start is still the previous date', () => {
	expect(getCurrentDateStr(NY3, new Date('2026-10-12T06:59:00Z'))).toEqual('2026-10-11'); // 02:59 EDT
	expect(getCurrentDateStr(NY3, new Date('2026-10-12T07:00:00Z'))).toEqual('2026-10-12'); // 03:00 EDT
	expect(getCurrentDateStr(NY3, new Date('2026-10-12T04:00:00Z'))).toEqual('2026-10-11'); // 00:00 EDT
});

test('toLocalDateStr - timestamps bucket by the day start, date-only strings do not', () => {
	expect(toLocalDateStr('2026-10-12T06:59:00Z', NY3)).toEqual('2026-10-11');
	expect(toLocalDateStr('2026-10-12T07:00:00Z', NY3)).toEqual('2026-10-12');
	expect(toLocalDateStr('2026-10-12', NY3)).toEqual('2026-10-12');
});

test('a zero day start is midnight, same as the bare zone', () => {
	const at = new Date('2026-10-12T04:00:00Z'); // 00:00 EDT
	expect(getCurrentDateStr({ tz: 'America/New_York', dayStart: 0 }, at)).toEqual('2026-10-12');
	expect(getCurrentDateStr('America/New_York', at)).toEqual('2026-10-12');
});

test('day start follows wall-clock time across DST changes', () => {
	// Spring forward 2026-03-08: 02:00 EST jumps to 03:00 EDT.
	expect(toLocalDateStr('2026-03-08T06:59:00Z', NY3)).toEqual('2026-03-07'); // 01:59 EST
	expect(toLocalDateStr('2026-03-08T07:00:00Z', NY3)).toEqual('2026-03-08'); // 03:00 EDT
	expect(toLocalDateStr('2026-03-08T07:30:00Z', NY3)).toEqual('2026-03-08'); // 03:30 EDT
	// Fall back 2026-11-01: 02:00 EDT returns to 01:00 EST.
	expect(toLocalDateStr('2026-11-01T07:59:00Z', NY3)).toEqual('2026-10-31'); // 02:59 EST
	expect(toLocalDateStr('2026-11-01T08:00:00Z', NY3)).toEqual('2026-11-01'); // 03:00 EST
});

test('day start rolls back across month and year boundaries', () => {
	expect(getCurrentDateStr({ tz: 'UTC', dayStart: 180 }, new Date('2027-01-01T02:00:00Z'))).toEqual(
		'2026-12-31'
	);
	expect(
		getCurrentDateStr({ tz: 'UTC', dayStart: 1439 }, new Date('2026-03-01T23:58:00Z'))
	).toEqual('2026-02-28');
	// Minute precision: 23:59 already belongs to the new day.
	expect(
		getCurrentDateStr({ tz: 'UTC', dayStart: 1439 }, new Date('2026-03-01T23:59:00Z'))
	).toEqual('2026-03-01');
});

test('diffDays counts calendar days between date strings', () => {
	expect(diffDays('2026-01-01', '2026-01-08')).toBe(7);
	expect(diffDays('2026-01-08', '2026-01-01')).toBe(-7);
	expect(diffDays('2026-03-01', '2026-03-01')).toBe(0);
	// across a DST transition (US spring forward 2026-03-08)
	expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
});
