import { addDays, getCurrentDateStr, type DayZone } from './timezone.ts';

export const PRESET_LABELS = ['7D', '30D', '90D', '1Y', 'MTD', 'YTD', 'ALL'] as const;
export type PresetLabel = (typeof PRESET_LABELS)[number];

const ALL_START = '2025-01-10';

export function getPresetRange(
	label: PresetLabel,
	tz: DayZone,
	now: Date = new Date()
): { start: string; end: string } {
	const today = getCurrentDateStr(tz, now);
	switch (label) {
		case '7D':
			return { start: addDays(today, -7), end: today };
		case '30D':
			return { start: addDays(today, -30), end: today };
		case '90D':
			return { start: addDays(today, -90), end: today };
		case '1Y': {
			const [y, m, d] = today.split('-');
			return { start: `${Number(y) - 1}-${m}-${d}`, end: today };
		}
		case 'MTD':
			return { start: `${today.slice(0, 7)}-01`, end: today };
		case 'YTD':
			return { start: `${today.slice(0, 4)}-01-01`, end: today };
		case 'ALL':
			return { start: ALL_START, end: today };
		default:
			throw new Error(`Unknown preset: ${label}`);
	}
}
