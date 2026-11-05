import { expect, it } from 'vitest';
import { render } from 'svelte/server';
import MarkerDatePicker from './MarkerDatePicker.svelte';

it('renders the timeline-style calendar trigger with its accessible date label', () => {
	const { body } = render(MarkerDatePicker, { props: { value: '2026-03-08', label: 'Date' } });
	expect(body).toContain('aria-label="Date"');
	expect(body).toContain('Mar 8, 2026');
	expect(body).toContain('border-border-default');
	expect(body).not.toMatch(/<input[^>]*type="date"/);
});
it('allows an initially empty optional end date without substituting today', () => {
	const { body } = render(MarkerDatePicker, {
		props: { label: 'End date', minDate: '2026-03-08' }
	});
	expect(body).toContain('Pick date');
	expect(body).toContain('aria-label="End date"');
});
it('keeps a leap-day calendar label in the same calendar day', () => {
	const { body } = render(MarkerDatePicker, { props: { value: '2024-02-29', label: 'Date' } });
	expect(body).toContain('Feb 29, 2024');
});
