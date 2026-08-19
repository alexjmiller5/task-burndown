import type { HistoryEntry } from '$lib/types.js';

// Real ledgers write "None" (and historically "undefined") for an unset due date.
const NULL_DUES = new Set(['None', 'undefined', 'null', '']);

/**
 * Parses the "Tag & Date History" rich text field into per-day entries.
 * Format: [YYYY-MM-DD HH:MM] --- Tags: [tag1, tag2], Due Date: YYYY-MM-DD
 *
 * Entries are sorted by timestamp first (ledgers contain out-of-order,
 * mixed-timezone timestamps), then collapsed to the last state of each day —
 * so several edits within one day read as a single net state change.
 */
export function parseHistoryLedger(text: string): HistoryEntry[] {
	if (!text) return [];

	const regex =
		/\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\] --- Tags: \[(.*?)\](?:, Due Date: (.*?))?$/gm;
	const raw: { date: string; time: string; tags: string[]; dueDate: string | null }[] = [];
	let match;
	while ((match = regex.exec(text)) !== null) {
		const due = match[4];
		raw.push({
			date: match[1],
			time: match[2],
			tags: match[3] ? match[3].split(', ').filter((t) => t) : [],
			dueDate: due && !NULL_DUES.has(due) ? due : null
		});
	}
	raw.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

	const dailyState = new Map<string, { tags: string[]; dueDate: string | null }>();
	for (const e of raw) {
		dailyState.set(e.date, { tags: e.tags, dueDate: e.dueDate });
	}

	return Array.from(dailyState.entries())
		.map(([date, state]) => ({ date, ...state }))
		.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Dates on which the task's due date was pushed back: day-over-day transitions
 * where both states have a due date and the new one is later. Setting, clearing,
 * and pulling in a due date are not push backs; entries recorded after the
 * completion date (backdated bookkeeping) are ignored.
 */
export function getPushbackDates(entries: HistoryEntry[], completedDate: string | null): string[] {
	const dates: string[] = [];
	for (let i = 1; i < entries.length; i++) {
		const prev = entries[i - 1];
		const cur = entries[i];
		if (completedDate && cur.date > completedDate) break;
		if (prev.dueDate && cur.dueDate && cur.dueDate > prev.dueDate) {
			dates.push(cur.date);
		}
	}
	return dates;
}
