import { expect, test } from 'vitest';
import {
	addDays,
	DEFAULT_TIMEZONE,
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

test('DEFAULT_TIMEZONE is America/New_York', () => {
	expect(DEFAULT_TIMEZONE).toEqual('America/New_York');
});
