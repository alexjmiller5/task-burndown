import type { ChartMode, GroupBy } from '$lib/types.js';
import { PROJECT_KINDS, type ProjectKind } from './filters.ts';
import { PRESET_LABELS, type PresetLabel } from './presets.ts';

export const STORAGE_KEY = 'burndown:prefs:v1';

export interface StoredPreferences {
	version: 1;
	timezone: string;
	groupBy: GroupBy;
	chartMode?: ChartMode;
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

function hasLocalStorage(): boolean {
	try {
		return typeof localStorage !== 'undefined';
	} catch {
		return false;
	}
}

function isSubset(v: unknown, allowed: readonly string[]): boolean {
	return v === undefined || (Array.isArray(v) && v.every((x) => allowed.includes(x)));
}

function isValid(parsed: unknown): parsed is StoredPreferences {
	if (typeof parsed !== 'object' || parsed === null) return false;
	const p = parsed as Record<string, unknown>;
	if (p.version !== 1) return false;
	if (typeof p.timezone !== 'string') return false;
	if (typeof p.groupBy !== 'string' || !VALID_GROUP_BY.includes(p.groupBy as GroupBy)) return false;
	if (p.chartMode !== undefined && p.chartMode !== 'active' && p.chartMode !== 'rate') return false;
	if (!isSubset(p.projectKinds, PROJECT_KINDS)) return false;
	for (const k of ['showLegacyTags', 'includeCanceled', 'showCompleted', 'showMarkers'])
		if (p[k] !== undefined && typeof p[k] !== 'boolean') return false;
	if (p.preset !== null && !PRESET_LABELS.includes(p.preset as PresetLabel)) return false;
	if (p.dateStart !== undefined && typeof p.dateStart !== 'string') return false;
	if (p.dateEnd !== undefined && typeof p.dateEnd !== 'string') return false;
	return true;
}

export function loadPreferences(): StoredPreferences | null {
	if (!hasLocalStorage()) return null;
	const raw = localStorage.getItem(STORAGE_KEY);
	if (raw === null) return null;
	try {
		const parsed = JSON.parse(raw);
		return isValid(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function savePreferences(prefs: StoredPreferences): void {
	if (!hasLocalStorage()) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
