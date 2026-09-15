import { expect, test } from 'vitest';
import {
	loadPreferences,
	savePreferences,
	STORAGE_KEY,
	type StoredPreferences
} from './preferences.ts';

function installStubStorage(): {
	get: (k: string) => string | null;
	setItems: Record<string, string>;
} {
	const setItems: Record<string, string> = {};
	const stub = {
		getItem: (k: string) => (k in setItems ? setItems[k] : null),
		setItem: (k: string, v: string) => {
			setItems[k] = v;
		},
		removeItem: (k: string) => {
			delete setItems[k];
		},
		clear: () => {
			for (const k of Object.keys(setItems)) delete setItems[k];
		},
		key: (i: number) => Object.keys(setItems)[i] ?? null,
		get length() {
			return Object.keys(setItems).length;
		}
	};
	// ponytail: cast needed — vitest runs in jsdom/node where globalThis.localStorage may be defined
	(globalThis as any).localStorage = stub;
	return { get: (k) => stub.getItem(k), setItems };
}

function uninstallStubStorage() {
	// ponytail: cast needed — same reason as above
	delete (globalThis as any).localStorage;
}

function validPrefs(overrides: Partial<StoredPreferences> = {}): StoredPreferences {
	return {
		version: 1,
		timezone: 'America/New_York',
		groupBy: 'tag',
		preset: '90D',
		...overrides
	};
}

test('loadPreferences — returns null when storage empty', () => {
	installStubStorage();
	try {
		expect(loadPreferences()).toEqual(null);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — returns null when JSON is malformed', () => {
	const { setItems } = installStubStorage();
	setItems[STORAGE_KEY] = '{not json';
	try {
		expect(loadPreferences()).toEqual(null);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — returns null when version is not 1', () => {
	const { setItems } = installStubStorage();
	setItems[STORAGE_KEY] = JSON.stringify({ ...validPrefs(), version: 2 });
	try {
		expect(loadPreferences()).toEqual(null);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — returns null when version field missing', () => {
	const { setItems } = installStubStorage();
	setItems[STORAGE_KEY] = JSON.stringify({ timezone: 'UTC', groupBy: 'tag' });
	try {
		expect(loadPreferences()).toEqual(null);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — round-trips preset-driven payload', () => {
	installStubStorage();
	try {
		const prefs = validPrefs({ preset: '30D', groupBy: 'priority' });
		savePreferences(prefs);
		expect(loadPreferences()).toEqual(prefs);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — round-trips slider-drag payload with explicit dates', () => {
	installStubStorage();
	try {
		const prefs = validPrefs({
			preset: null,
			dateStart: '2026-04-01',
			dateEnd: '2026-05-15'
		});
		savePreferences(prefs);
		expect(loadPreferences()).toEqual(prefs);
	} finally {
		uninstallStubStorage();
	}
});

test('savePreferences — writes under the expected storage key', () => {
	const { get } = installStubStorage();
	try {
		savePreferences(validPrefs());
		const raw = get(STORAGE_KEY);
		expect(raw !== null).toEqual(true);
		const parsed = JSON.parse(raw!);
		expect(parsed.version).toEqual(1);
		expect(parsed.timezone).toEqual('America/New_York');
	} finally {
		uninstallStubStorage();
	}
});

test('savePreferences — overwrites previous value', () => {
	installStubStorage();
	try {
		savePreferences(validPrefs({ groupBy: 'tag' }));
		savePreferences(validPrefs({ groupBy: 'project' }));
		expect(loadPreferences()?.groupBy).toEqual('project');
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — no-op without localStorage (SSR safety)', () => {
	// Ensure no stub installed
	uninstallStubStorage();
	expect(loadPreferences()).toEqual(null);
});

test('savePreferences — no-op without localStorage (SSR safety)', () => {
	uninstallStubStorage();
	expect(() => savePreferences(validPrefs())).not.toThrow();
});

test('loadPreferences — invalid groupBy is rejected', () => {
	const { setItems } = installStubStorage();
	setItems[STORAGE_KEY] = JSON.stringify({
		version: 1,
		timezone: 'UTC',
		groupBy: 'bogus',
		preset: null
	});
	try {
		expect(loadPreferences()).toEqual(null);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — invalid preset label is rejected', () => {
	const { setItems } = installStubStorage();
	setItems[STORAGE_KEY] = JSON.stringify({
		version: 1,
		timezone: 'UTC',
		groupBy: 'tag',
		preset: 'INVALID'
	});
	try {
		expect(loadPreferences()).toEqual(null);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — round-trips lens arrays', () => {
	installStubStorage();
	try {
		const prefs = validPrefs({
			tagKinds: ['legacy'],
			projectKinds: ['none'],
			hiddenStatuses: ['Canceled', 'Completed'],
			sameDayKinds: ['same', 'other']
		});
		savePreferences(prefs);
		expect(loadPreferences()).toEqual(prefs);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — rejects unknown lens values', () => {
	const { setItems } = installStubStorage();
	try {
		setItems[STORAGE_KEY] = JSON.stringify(validPrefs({ projectKinds: ['bogus'] as any }));
		expect(loadPreferences()).toEqual(null);
		setItems[STORAGE_KEY] = JSON.stringify(validPrefs({ hiddenStatuses: [1] as any }));
		expect(loadPreferences()).toEqual(null);
	} finally {
		uninstallStubStorage();
	}
});

test('loadPreferences — ignores the retired boolean toggles', () => {
	const { setItems } = installStubStorage();
	try {
		setItems[STORAGE_KEY] = JSON.stringify({
			...validPrefs(),
			showLegacyTags: true,
			includeCanceled: true
		});
		expect(loadPreferences()?.groupBy).toEqual('tag');
	} finally {
		uninstallStubStorage();
	}
});
