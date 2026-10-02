<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { MARKER_LABEL_MAX, parseMarkers, type ChartMarker } from '$lib/markers.js';

	interface Props {
		markers: ChartMarker[];
		today: string;
		onsaved: (markers: ChartMarker[]) => void;
	}
	let { markers, today, onsaved }: Props = $props();

	const DIRECTION_LABELS: Record<ChartMarker['direction'], string> = {
		up: 'Backlog grew',
		down: 'Backlog shrank',
		flat: 'Quiet band'
	};
	const DIRECTION_COLORS: Record<ChartMarker['direction'], string> = {
		up: '#f87171',
		down: '#4ade80',
		flat: '#94a3b8'
	};
	// Heroicons (outline): pencil-square, plus, trash
	const PENCIL =
		'm16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10';
	const PLUS = 'M12 4.5v15m7.5-7.5h-15';
	const TRASH =
		'm14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0';

	let open = $state(false);
	let draft: ChartMarker[] = $state([]);
	let error: string | null = $state(null);
	let saving = $state(false);

	function openEditor() {
		// Newest first: the marker being added or tuned is almost always recent
		draft = markers.map((m) => ({ ...m })).reverse();
		error = null;
		open = true;
	}

	function add() {
		draft = [{ date: today, label: '', direction: 'down' }, ...draft];
	}

	function setDirection(i: number, v: string) {
		const d = v as ChartMarker['direction'];
		draft[i].direction = d;
		if (d === 'flat' && !draft[i].end) draft[i].end = draft[i].date;
	}

	async function save() {
		error = null;
		let parsed: ChartMarker[];
		try {
			parsed = parseMarkers(draft);
		} catch (e) {
			error = (e as Error).message.replace(/^marker (\d+)/, (_, i) => `Row ${Number(i) + 1}`);
			return;
		}
		saving = true;
		try {
			const res = await fetch('/api/markers', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(parsed)
			});
			const body = (await res.json()) as ChartMarker[] & { error?: string };
			if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
			onsaved(body);
			open = false;
		} catch (e) {
			error = `Save failed: ${(e as Error).message}`;
		} finally {
			saving = false;
		}
	}
</script>

{#snippet icon(d: string, cls: string = 'w-4 h-4')}
	<svg
		class={cls}
		xmlns="http://www.w3.org/2000/svg"
		fill="none"
		viewBox="0 0 24 24"
		stroke-width="1.5"
		stroke="currentColor"
		aria-hidden="true"
	>
		<path stroke-linecap="round" stroke-linejoin="round" {d} />
	</svg>
{/snippet}

<Button
	variant="outline"
	onclick={openEditor}
	class="h-auto rounded-control border-border-default px-2.5 py-2 text-muted dark:bg-transparent dark:hover:bg-secondary/40 hover:border-border-strong"
	title="Edit event markers"
	aria-label="Edit event markers"
>
	{@render icon(PENCIL)}
</Button>

<Dialog.Root bind:open>
	<Dialog.Content
		class="sm:max-w-3xl max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto] border border-border-default bg-surface p-5 ring-0"
	>
		<Dialog.Header>
			<Dialog.Title class="font-[var(--font-heading)] text-lg">Event markers</Dialog.Title>
			<Dialog.Description class="text-muted text-xs">
				Annotations drawn on both charts. Stored with the app, not in Notion.
			</Dialog.Description>
		</Dialog.Header>

		<div class="min-h-0 overflow-y-auto -mx-1 px-1 flex flex-col gap-2">
			<Button
				variant="outline"
				onclick={add}
				class="h-auto self-start gap-2 rounded-control border-border-default px-3 py-2 font-[var(--font-mono)] text-xs tracking-wider text-muted uppercase dark:bg-transparent hover:border-bitcoin/40"
			>
				{@render icon(PLUS)}
				<span>Add marker</span>
			</Button>
			{#each draft as m, i (i)}
				<div
					class="grid grid-cols-2 sm:grid-cols-[8.5rem_8.5rem_minmax(0,1fr)_9.5rem_auto] items-center gap-2 rounded-control border border-border-subtle p-2"
				>
					<Input
						type="date"
						bind:value={m.date}
						aria-label="Date"
						class="font-[var(--font-mono)] text-xs [color-scheme:dark]"
					/>
					{#if m.direction === 'flat'}
						<Input
							type="date"
							bind:value={m.end}
							aria-label="End date"
							class="font-[var(--font-mono)] text-xs [color-scheme:dark]"
						/>
					{:else}
						<span class="hidden sm:block text-center text-muted/50 text-xs">-</span>
					{/if}
					<Input
						bind:value={m.label}
						maxlength={MARKER_LABEL_MAX}
						placeholder="Label"
						aria-label="Label"
						class="col-span-2 sm:col-span-1 text-sm"
					/>
					<Select.Root type="single" value={m.direction} onValueChange={(v) => setDirection(i, v)}>
						<Select.Trigger
							class="h-8 w-full gap-2 rounded-lg border-input font-[var(--font-mono)] text-xs dark:bg-input/30"
							aria-label="Direction"
						>
							<span class="flex items-center gap-2">
								<span
									class="size-2 shrink-0 rounded-full"
									style="background: {DIRECTION_COLORS[m.direction]};"
								></span>
								{DIRECTION_LABELS[m.direction]}
							</span>
						</Select.Trigger>
						<Select.Content class="font-[var(--font-mono)] text-xs">
							{#each Object.entries(DIRECTION_LABELS) as [value, label]}
								<Select.Item {value} {label} />
							{/each}
						</Select.Content>
					</Select.Root>
					<Button
						variant="ghost"
						size="icon-sm"
						onclick={() => (draft = draft.filter((_, j) => j !== i))}
						class="justify-self-end text-muted hover:text-red-400"
						title="Delete marker"
						aria-label="Delete marker"
					>
						{@render icon(TRASH)}
					</Button>
				</div>
			{:else}
				<p class="py-6 text-center text-muted text-sm">No markers yet.</p>
			{/each}
		</div>

		<div class="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
			{#if error}
				<p class="text-red-400 text-xs sm:mr-auto">{error}</p>
			{/if}
			<div class="flex gap-2 sm:ml-auto">
				<Button
					variant="outline"
					onclick={() => (open = false)}
					class="h-auto flex-1 sm:flex-none rounded-control border-border-default px-4 py-2 font-[var(--font-mono)] text-xs tracking-wider uppercase text-muted dark:bg-transparent"
					>Cancel</Button
				>
				<Button
					onclick={save}
					disabled={saving}
					class="h-auto flex-1 sm:flex-none rounded-control px-4 py-2 font-[var(--font-mono)] text-xs tracking-wider uppercase"
					>{saving ? 'Saving' : 'Save'}</Button
				>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
