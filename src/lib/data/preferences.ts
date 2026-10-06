import type { ChartMode, GroupBy } from '$lib/types.js';
import type { FlowBucket } from './metrics';
import { DEFAULT_TIMEZONE } from './timezone';
import { PROJECT_KINDS, type ProjectKind } from './filters.ts';
import { PRESET_LABELS, type PresetLabel } from './presets.ts';

export const STORAGE_KEY = 'burndown:prefs:v1';

export interface StoredPreferences {
	version: 1;
	timezone: string;
	groupBy: GroupBy;
	chartMode?: ChartMode;
	flowBucket?: FlowBucket;
	showLegacyTags?: boolean;
	/** Project lens: which kinds are shown (an empty list never persists - it snaps to all). */
	projectKinds?: ProjectKind[];
	includeCanceled?: boolean;
	showCompleted?: boolean;
	showMarkers?: boolean;
	preset: PresetLabel | null;
	dateStart?: string;
	dateEnd?: string;
}

const VALID_GROUP_BY: ReadonlyArray<GroupBy> = ['tag', 'priority', 'project', 'age', 'ai'];

function validDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(value + 'T00:00:00Z');
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parsePreferences(parsed: unknown): StoredPreferences | null {
	if (!parsed || typeof parsed !== 'object') return null;
	const p = parsed as Record<string, unknown>;
	if (p.version !== 1) return null;
	let timezone = DEFAULT_TIMEZONE;
	if (typeof p.timezone === 'string') {
		try {
			new Intl.DateTimeFormat('en', { timeZone: p.timezone }).format();
			timezone = p.timezone;
		} catch {
			/* Fall back for this field only. */
		}
	}
	const prefs: StoredPreferences = {
		version: 1,
		timezone,
		groupBy: VALID_GROUP_BY.includes(p.groupBy as GroupBy) ? (p.groupBy as GroupBy) : 'tag',
		preset: PRESET_LABELS.includes(p.preset as PresetLabel) ? (p.preset as PresetLabel) : '90D'
	};
	if (
		p.preset === null &&
		validDate(p.dateStart) &&
		validDate(p.dateEnd) &&
		p.dateStart <= p.dateEnd
	) {
		prefs.preset = null;
		prefs.dateStart = p.dateStart;
		prefs.dateEnd = p.dateEnd;
	}
	if (p.chartMode === 'active' || p.chartMode === 'rate') prefs.chartMode = p.chartMode;
	if (p.flowBucket === 'day' || p.flowBucket === 'week' || p.flowBucket === 'month')
		prefs.flowBucket = p.flowBucket;
	if (Array.isArray(p.projectKinds)) {
		const kinds = PROJECT_KINDS.filter(
			(k) => p.projectKinds instanceof Array && p.projectKinds.includes(k)
		);
		prefs.projectKinds = kinds.length ? kinds : [...PROJECT_KINDS];
	}
	for (const key of [
		'showLegacyTags',
		'includeCanceled',
		'showCompleted',
		'showMarkers'
	] as const) {
		if (typeof p[key] === 'boolean') prefs[key] = p[key];
	}
	return prefs;
}

export function loadPreferences(): StoredPreferences | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw === null ? null : parsePreferences(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function savePreferences(prefs: StoredPreferences): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		/* Blocked or full storage must not prevent using the dashboard. */
	}
}
