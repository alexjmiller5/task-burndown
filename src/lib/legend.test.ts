import { describe, it, expect } from 'vitest';
import { syncHiddenLabels } from './legend.ts';

describe('syncHiddenLabels', () => {
	it('keeps user toggles when the category set is unchanged (range change)', () => {
		const hidden = new Set<string>();
		const key = syncHiddenLabels(hidden, null, ['High', 'Low'], []);
		hidden.add('High'); // user clicks High off in the legend
		syncHiddenLabels(hidden, key, ['High', 'Low'], []);
		expect(hidden).toEqual(new Set(['High']));
	});

	it('clears toggles and reseeds defaults when categories change (view switch)', () => {
		const hidden = new Set<string>();
		const key = syncHiddenLabels(hidden, null, ['High', 'Low'], []);
		hidden.add('High');
		syncHiddenLabels(hidden, key, ['ProjA', '(No Project)'], ['(No Project)']);
		expect(hidden).toEqual(new Set(['(No Project)']));
	});

	it('keep-labels survive a category change', () => {
		const hidden = new Set<string>();
		const key = syncHiddenLabels(hidden, null, ['High', 'Low'], [], ['14d avg']);
		hidden.add('High');
		hidden.add('14d avg');
		syncHiddenLabels(hidden, key, ['<1w', '6m+'], [], ['14d avg']);
		expect(hidden).toEqual(new Set(['14d avg']));
	});

	it('seeds defaults on first build', () => {
		const hidden = new Set<string>();
		syncHiddenLabels(hidden, null, ['ProjA', '(No Project)'], ['(No Project)']);
		expect(hidden).toEqual(new Set(['(No Project)']));
	});

	it('a re-shown default stays shown across a range change', () => {
		const hidden = new Set<string>();
		const key = syncHiddenLabels(hidden, null, ['ProjA', '(No Project)'], ['(No Project)']);
		hidden.delete('(No Project)'); // user clicks it back on
		syncHiddenLabels(hidden, key, ['ProjA', '(No Project)'], ['(No Project)']);
		expect(hidden.size).toBe(0);
	});
});
