import type { ChartMode, GroupBy } from '$lib/types.js';
import { PROJECT_KINDS, SAME_DAY_KINDS, type ProjectKind, type SameDayKind } from './filters.ts';
import { PRESET_LABELS, type PresetLabel } from './presets.ts';

export type TagKind = 'current' | 'legacy';
export const TAG_KINDS: readonly TagKind[] = ['current', 'legacy'];

export const STORAGE_KEY = 'burndown:prefs:v1';

export interface StoredPreferences {
	version: 1;
	timezone: string;
	groupBy: GroupBy;
	chartMode?: ChartMode;
	/** Lenses: which kinds are shown (an empty list never persists - it snaps to all). */
	tagKinds?: TagKind[];
	projectKinds?: ProjectKind[];
	hiddenStatuses?: string[];
	sameDayKinds?: SameDayKind[];
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
	if (!isSubset(p.tagKinds, TAG_KINDS)) return false;
	if (!isSubset(p.projectKinds, PROJECT_KINDS)) return false;
	if (!isSubset(p.sameDayKinds, SAME_DAY_KINDS)) return false;
	if (
		p.hiddenStatuses !== undefined &&
		!(Array.isArray(p.hiddenStatuses) && p.hiddenStatuses.every((x) => typeof x === 'string'))
	)
		return false;
	if (p.showMarkers !== undefined && typeof p.showMarkers !== 'boolean') return false;
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
