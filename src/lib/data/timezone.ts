export interface TimezoneOption {
	id: string;
	label: string;
}

export const TIMEZONES: TimezoneOption[] = [
	{ id: 'America/New_York', label: 'New York (ET)' },
	{ id: 'America/Chicago', label: 'Chicago (CT)' },
	{ id: 'America/Denver', label: 'Denver (MT)' },
	{ id: 'America/Los_Angeles', label: 'Los Angeles (PT)' },
	{ id: 'America/Anchorage', label: 'Anchorage (AKT)' },
	{ id: 'Pacific/Honolulu', label: 'Honolulu (HT)' },
	{ id: 'UTC', label: 'UTC' },
	{ id: 'Europe/London', label: 'London (UK)' }
];

/** The default picker value: the zone this device runs in, resolved at run time. */
export const DEVICE_TIMEZONE = 'device';

/**
 * Where calendar days are counted: an IANA zone whose days start at midnight,
 * or a zone plus `dayStart`, the wall-clock minute (0-1439) a new day begins.
 */
export type DayZone = string | { tz: string; dayStart: number };

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const FLOATING_RE = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})$/;

// Intl.DateTimeFormat construction is expensive; cache one formatter per tz.
const formatters = new Map<string, Intl.DateTimeFormat>();
function getFormatter(tz: string, clock: boolean): Intl.DateTimeFormat {
	const key = `${tz} ${clock}`;
	let f = formatters.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			...(clock && { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
		});
		formatters.set(key, f);
	}
	return f;
}

/** The date `instant` falls on in `zone`; wall-clock times before its day start count as the day before. */
function dateIn(instant: Date, zone: DayZone): string {
	const { tz, dayStart } = typeof zone === 'string' ? { tz: zone, dayStart: 0 } : zone;
	// Midnight days need no clock; plain format is ~3x faster than formatToParts.
	if (!dayStart) return getFormatter(tz, false).format(instant);
	const p: Record<string, string> = {};
	for (const { type, value } of getFormatter(tz, true).formatToParts(instant)) p[type] = value;
	const date = `${p.year}-${p.month}-${p.day}`;
	return Number(p.hour) * 60 + Number(p.minute) < dayStart ? addDays(date, -1) : date;
}

/**
 * The day a stored date falls on: dates as-is, instants in `zone`, and floating
 * local times (`YYYY-MM-DDTHH:MM`, no zone) by their own wall clock.
 */
export function toLocalDateStr(value: string, zone: DayZone): string {
	if (DATE_ONLY_RE.test(value)) return value;
	const floating = FLOATING_RE.exec(value);
	if (!floating) return dateIn(new Date(value), zone);
	const dayStart = typeof zone === 'string' ? 0 : zone.dayStart;
	const date = value.slice(0, 10);
	return Number(floating[1]) * 60 + Number(floating[2]) < dayStart ? addDays(date, -1) : date;
}

/** Calendar days from dateStr a to b (UTC arithmetic, DST-safe). */
export function diffDays(a: string, b: string): number {
	const [ay, am, ad] = a.split('-').map(Number);
	const [by, bm, bd] = b.split('-').map(Number);
	return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000;
}

export function addDays(dateStr: string, days: number): string {
	const [y, m, d] = dateStr.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, d));
	date.setUTCDate(date.getUTCDate() + days);
	const yy = date.getUTCFullYear();
	const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(date.getUTCDate()).padStart(2, '0');
	return `${yy}-${mm}-${dd}`;
}

// Same day `months` later, or the target month's last day when it is shorter (Dec 31 + 2 = Feb 28).
export function addMonths(dateStr: string, months: number): string {
	const [y, m, d] = dateStr.split('-').map(Number);
	// Day 0 of the month after the target is the target's last day.
	const lastDay = new Date(Date.UTC(y, m + months, 0)).getUTCDate();
	return new Date(Date.UTC(y, m - 1 + months, Math.min(d, lastDay))).toISOString().slice(0, 10);
}

export function getCurrentDateStr(zone: DayZone, now: Date = new Date()): string {
	return dateIn(now, zone);
}
