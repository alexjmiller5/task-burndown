<script lang="ts">
	import { parseDate } from '@internationalized/date';
	import { Calendar } from '$lib/components/ui/calendar';
	import * as Popover from '$lib/components/ui/popover';
	let {
		value = $bindable(),
		label,
		minDate
	}: { value?: string; label: string; minDate?: string } = $props();
	let open = $state(false);
	const selected = $derived(value ? parseDate(value) : undefined);
	const text = $derived(
		selected
			? new Intl.DateTimeFormat('en-US', {
					month: 'short',
					day: 'numeric',
					year: 'numeric',
					timeZone: 'UTC'
				}).format(selected.toDate('UTC'))
			: 'Pick date'
	);
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class="inline-flex min-h-9 w-full items-center gap-1.5 rounded-control border border-border-default px-2 py-1 font-[var(--font-mono)] text-xs text-muted uppercase outline-none hover:border-border-strong focus-visible:ring-1 focus-visible:ring-bitcoin"
		aria-label={label}
	>
		<svg
			class="size-3.5 shrink-0"
			xmlns="http://www.w3.org/2000/svg"
			fill="none"
			viewBox="0 0 24 24"
			stroke-width="1.5"
			stroke="currentColor"
			aria-hidden="true"
		>
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
			/>
		</svg>
		{text}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-0" align="start">
		<Calendar
			type="single"
			value={selected}
			minValue={minDate ? parseDate(minDate) : undefined}
			captionLayout="dropdown"
			preventDeselect
			onValueChange={(day) => {
				if (day) {
					value = day.toString();
					open = false;
				}
			}}
		/>
	</Popover.Content>
</Popover.Root>
