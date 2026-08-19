import { expect, test } from 'vitest';
import { parseHistoryLedger } from './history.ts';

test('parseHistoryLedger collapses same-day entries to the last state of the day', () => {
	const entries = parseHistoryLedger(
		'[2026-08-18 12:57] --- Tags: [Chore], Due Date: 2026-08-18\n' +
			'[2026-08-18 12:58] --- Tags: [Chore], Due Date: 2026-08-20'
	);
	expect(entries).toEqual([{ date: '2026-08-18', tags: ['Chore'], dueDate: '2026-08-20' }]);
});

test('parseHistoryLedger treats the literal "None" as no due date', () => {
	const entries = parseHistoryLedger('[2026-08-17 16:35] --- Tags: [], Due Date: None');
	expect(entries[0].dueDate).toBeNull();
});

test('parseHistoryLedger sorts out-of-order entries by timestamp before collapsing', () => {
	// Real ledgers contain mixed-timezone timestamps written out of order; the
	// last state for a day must be picked by time, not by position in the text.
	const entries = parseHistoryLedger(
		'[2026-02-24 21:35] --- Tags: [Project], Due Date: 2026-02-24\n' +
			'[2026-02-24 02:41] --- Tags: [], Due Date: None'
	);
	expect(entries).toEqual([{ date: '2026-02-24', tags: ['Project'], dueDate: '2026-02-24' }]);
});
