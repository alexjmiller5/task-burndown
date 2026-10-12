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

export function toLocalDateStr(value: string, zone: DayZone): string {
	if (DATE_ONLY_RE.test(value)) return value;
	return dateIn(new Date(value), zone);
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

export function getCurrentDateStr(zone: DayZone, now: Date = new Date()): string {
	return dateIn(now, zone);
}
