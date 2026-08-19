import { expect, test } from 'vitest';
import { parseHistoryLedger, getPushbackDates } from './history.ts';

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

function ledger(lines: [string, string | null][]): string {
	return lines
		.map(([ts, due], i) => `[${ts}] --- Tags: [], Due Date: ${due ?? 'None'}`)
		.join('\n');
}

test('getPushbackDates counts a day-over-day later move as one push back', () => {
	const entries = parseHistoryLedger(
		ledger([
			['2026-07-01 10:00', '2026-07-03'],
			['2026-07-02 10:00', '2026-07-08']
		])
	);
	expect(getPushbackDates(entries, null)).toEqual(['2026-07-02']);
});

test('getPushbackDates counts multiple later-moves in one day as a single push back', () => {
	const entries = parseHistoryLedger(
		ledger([
			['2026-07-01 10:00', '2026-07-03'],
			['2026-07-02 10:00', '2026-07-05'],
			['2026-07-02 11:00', '2026-07-08']
		])
	);
	expect(getPushbackDates(entries, null)).toEqual(['2026-07-02']);
});

test('getPushbackDates ignores a same-day wobble that nets to an earlier date', () => {
	const entries = parseHistoryLedger(
		ledger([
			['2026-07-01 10:00', '2026-07-05'],
			['2026-07-02 10:00', '2026-07-09'],
			['2026-07-02 11:00', '2026-07-04']
		])
	);
	expect(getPushbackDates(entries, null)).toEqual([]);
});

test('getPushbackDates ignores setting a due date where there was none', () => {
	const entries = parseHistoryLedger(
		ledger([
			['2026-07-01 10:00', null],
			['2026-07-02 10:00', '2026-07-08']
		])
	);
	expect(getPushbackDates(entries, null)).toEqual([]);
});

test('getPushbackDates ignores clearing a due date and pull-ins', () => {
	const entries = parseHistoryLedger(
		ledger([
			['2026-07-01 10:00', '2026-07-08'],
			['2026-07-02 10:00', '2026-07-05'],
			['2026-07-03 10:00', null]
		])
	);
	expect(getPushbackDates(entries, null)).toEqual([]);
});

test('getPushbackDates ignores moves recorded after the completion date', () => {
	// Backdated completions produce ledger entries after the task was done.
	const entries = parseHistoryLedger(
		ledger([
			['2026-07-01 10:00', '2026-07-03'],
			['2026-07-15 10:00', '2026-07-20']
		])
	);
	expect(getPushbackDates(entries, '2026-07-10')).toEqual([]);
});

test('getPushbackDates counts each pushed-back day separately for serial punters', () => {
	const entries = parseHistoryLedger(
		ledger([
			['2026-07-01 10:00', '2026-07-02'],
			['2026-07-02 10:00', '2026-07-03'],
			['2026-07-03 10:00', '2026-07-04']
		])
	);
	expect(getPushbackDates(entries, null)).toEqual(['2026-07-02', '2026-07-03']);
});

test('getPushbackDates ignores entries where the due date is unchanged (tag-only edits)', () => {
	const entries = parseHistoryLedger(
		'[2026-07-01 10:00] --- Tags: [], Due Date: 2026-07-08\n' +
			'[2026-07-02 10:00] --- Tags: [Chore], Due Date: 2026-07-08'
	);
	expect(getPushbackDates(entries, null)).toEqual([]);
});
