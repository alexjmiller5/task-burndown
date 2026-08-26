import { describe, it, expect, test } from 'vitest';
import {
	syncHiddenGroup,
	syncLegendMemory,
	recordLegendToggle,
	hiddenLegendLabels,
	STORAGE_KEY
} from './legend.ts';

describe('syncHiddenGroup', () => {
	it('keeps user toggles when the group is unchanged (range change rebuild)', () => {
		const store: Record<string, string[]> = {};
		const hidden = new Set<string>();
		syncHiddenGroup(store, hidden, null, 'priority', []);
		hidden.add('High'); // user clicks High off in the legend
		syncHiddenGroup(store, hidden, 'priority', 'priority', []);
		expect(hidden).toEqual(new Set(['High']));
	});

	it('seeds defaults on first visit to a group', () => {
		const store: Record<string, string[]> = {};
		const hidden = new Set<string>();
		syncHiddenGroup(store, hidden, null, 'project', ['(No Project)']);
		expect(hidden).toEqual(new Set(['(No Project)']));
		expect(store.project).toEqual(['(No Project)']);
	});

	it('restores the saved toggles when switching back to a group', () => {
		const store: Record<string, string[]> = {};
		const hidden = new Set<string>();
		syncHiddenGroup(store, hidden, null, 'priority', []);
		hidden.add('High');
		store.priority = [...hidden]; // recordLegendToggle does this in the app
		syncHiddenGroup(store, hidden, 'priority', 'tag', []);
		expect(hidden.has('High')).toBe(false);
		syncHiddenGroup(store, hidden, 'tag', 'priority', []);
		expect(hidden).toEqual(new Set(['High']));
	});

	it('does not reseed defaults over a saved set', () => {
		const store: Record<string, string[]> = { project: [] }; // user re-showed the default
		const hidden = new Set<string>();
		syncHiddenGroup(store, hidden, null, 'project', ['(No Project)']);
		expect(hidden.size).toBe(0);
	});

	it('keep-labels carry their current state across a group switch', () => {
		const store: Record<string, string[]> = { age: ['<1w'] };
		const hidden = new Set<string>();
		syncHiddenGroup(store, hidden, null, 'priority', [], ['14d avg']);
		hidden.add('14d avg');
		syncHiddenGroup(store, hidden, 'priority', 'age', [], ['14d avg']);
		expect(hidden).toEqual(new Set(['<1w', '14d avg']));
	});

	it('restores a stored set on first build after a reload', () => {
		const store: Record<string, string[]> = { priority: ['High', '14d avg'] };
		const hidden = new Set<string>();
		syncHiddenGroup(store, hidden, null, 'priority', [], ['14d avg']);
		expect(hidden).toEqual(new Set(['High', '14d avg']));
	});
});

test('syncLegendMemory + recordLegendToggle round-trip through localStorage', () => {
	const items: Record<string, string> = {
		[STORAGE_KEY]: JSON.stringify({ priority: ['High'] })
	};
	(globalThis as Record<string, unknown>).localStorage = {
		getItem: (k: string) => (k in items ? items[k] : null),
		setItem: (k: string, v: string) => {
			items[k] = v;
		}
	};
	try {
		syncLegendMemory('priority', []);
		expect(hiddenLegendLabels).toEqual(new Set(['High']));
		recordLegendToggle('Low', true);
		expect(JSON.parse(items[STORAGE_KEY]).priority).toEqual(['High', 'Low']);
		recordLegendToggle('High', false);
		expect(JSON.parse(items[STORAGE_KEY]).priority).toEqual(['Low']);
	} finally {
		delete (globalThis as Record<string, unknown>).localStorage;
	}
});
