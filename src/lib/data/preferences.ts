import type { ChartMode, GroupBy } from '$lib/types.js';
import { PRESET_LABELS, type PresetLabel } from './presets.ts';

export const STORAGE_KEY = 'burndown:prefs:v1';

export interface StoredPreferences {
	version: 1;
	timezone: string;
	groupBy: GroupBy;
	chartMode?: ChartMode;
	showLegacyTags: boolean;
	includeProjectTasks: boolean;
	includeCanceled?: boolean;
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

function isValid(parsed: unknown): parsed is StoredPreferences {
	if (typeof parsed !== 'object' || parsed === null) return false;
	const p = parsed as Record<string, unknown>;
	if (p.version !== 1) return false;
	if (typeof p.timezone !== 'string') return false;
	if (typeof p.groupBy !== 'string' || !VALID_GROUP_BY.includes(p.groupBy as GroupBy)) return false;
	if (p.chartMode !== undefined && p.chartMode !== 'active' && p.chartMode !== 'flow') return false;
	if (typeof p.showLegacyTags !== 'boolean') return false;
	if (typeof p.includeProjectTasks !== 'boolean') return false;
	if (p.includeCanceled !== undefined && typeof p.includeCanceled !== 'boolean') return false;
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
