<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { addDays } from '$lib/data/timezone';

	interface Props {
		min: string;
		max: string;
		start: string;
		end: string;
		onchange: (start: string, end: string) => void;
	}

	let { min, max, start, end, onchange }: Props = $props();

	let track: HTMLDivElement;
	let dragging: 'start' | 'end' | 'range' | null = $state(null);
	let hovered: 'start' | 'end' | 'range' | 'track' | null = $state(null);
	let isTouch = $state(false);
	let didDrag = false;
	let dragStartX = 0;
	let dragStartVal = 0;
	let dragEndVal = 0;

	let touchMql: MediaQueryList | null = null;
	function syncIsTouch(e: MediaQueryListEvent | MediaQueryList) {
		isTouch = 'matches' in e ? e.matches : false;
	}

	onMount(() => {
		if (typeof window === 'undefined' || !window.matchMedia) return;
		touchMql = window.matchMedia('(pointer: coarse)');
		isTouch = touchMql.matches;
		touchMql.addEventListener('change', syncIsTouch);
	});

	onDestroy(() => {
		touchMql?.removeEventListener('change', syncIsTouch);
	});

	function dateToOffset(date: string): number {
		return Math.round((Date.parse(date) - Date.parse(min)) / 86400000);
	}

	function offsetToDate(offset: number): string {
		return addDays(min, offset);
	}

	let totalDays = $derived(dateToOffset(max));
	let startOffset = $derived(dateToOffset(start));
	let endOffset = $derived(dateToOffset(end));

	let startPct = $derived(totalDays > 0 ? (startOffset / totalDays) * 100 : 0);
	let endPct = $derived(totalDays > 0 ? (endOffset / totalDays) * 100 : 100);

	function formatLabel(date: string): string {
		const d = new Date(date + 'T00:00:00');
		const months = [
			'Jan',
			'Feb',
			'Mar',
			'Apr',
			'May',
			'Jun',
			'Jul',
			'Aug',
			'Sep',
			'Oct',
			'Nov',
			'Dec'
		];
		return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
	}

	function xToOffset(clientX: number): number {
		if (!track) return 0;
		const rect = track.getBoundingClientRect();
		const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		return Math.round(pct * totalDays);
	}

	function handlePointerDown(e: PointerEvent, type: 'start' | 'end' | 'range') {
		e.preventDefault();
		e.stopPropagation();
		// preventDefault blocks focus on press; focus the handle so arrow keys follow a click.
		(e.currentTarget as HTMLElement).focus();
		dragging = type;
		didDrag = false;
		dragStartX = e.clientX;
		dragStartVal = startOffset;
		dragEndVal = endOffset;
		(e.target as HTMLElement).setPointerCapture?.(e.pointerId);
		window.addEventListener('pointermove', handlePointerMove);
		window.addEventListener('pointerup', handlePointerUp);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging || !track) return;
		didDrag = true;
		const rect = track.getBoundingClientRect();
		const deltaPx = e.clientX - dragStartX;
		const deltaDays = Math.round((deltaPx / rect.width) * totalDays);

		if (dragging === 'start') {
			const newStart = Math.max(0, Math.min(endOffset - 1, dragStartVal + deltaDays));
			onchange(offsetToDate(newStart), end);
		} else if (dragging === 'end') {
			const newEnd = Math.max(startOffset + 1, Math.min(totalDays, dragEndVal + deltaDays));
			onchange(start, offsetToDate(newEnd));
		} else if (dragging === 'range') {
			const rangeSize = dragEndVal - dragStartVal;
			let newStart = dragStartVal + deltaDays;
			let newEnd = dragEndVal + deltaDays;
			if (newStart < 0) {
				newStart = 0;
				newEnd = rangeSize;
			}
			if (newEnd > totalDays) {
				newEnd = totalDays;
				newStart = totalDays - rangeSize;
			}
			onchange(offsetToDate(newStart), offsetToDate(newEnd));
		}
	}

	function handlePointerUp() {
		dragging = null;
		window.removeEventListener('pointermove', handlePointerMove);
		window.removeEventListener('pointerup', handlePointerUp);
	}

	function handleTrackClick(e: MouseEvent) {
		if (dragging || didDrag) {
			didDrag = false;
			return;
		}
		// A click on a handle or the span (they carry a role) is not a jump.
		if ((e.target as HTMLElement).hasAttribute('role')) return;
		const offset = xToOffset(e.clientX);
		const distToStart = Math.abs(offset - startOffset);
		const distToEnd = Math.abs(offset - endOffset);
		if (distToStart < distToEnd) {
			onchange(offsetToDate(Math.min(offset, endOffset - 1)), end);
		} else {
			onchange(start, offsetToDate(Math.max(offset, startOffset + 1)));
		}
	}

	function handleKey(e: KeyboardEvent, handle: 'start' | 'end'): void {
		const current = handle === 'start' ? startOffset : endOffset;
		const lower = handle === 'start' ? 0 : startOffset + 1;
		const upper = handle === 'start' ? endOffset - 1 : totalDays;
		const steps: Record<string, number> = {
			ArrowLeft: -1,
			ArrowDown: -1,
			ArrowRight: 1,
			ArrowUp: 1,
			PageDown: -7,
			PageUp: 7
		};
		const next =
			e.key === 'Home'
				? lower
				: e.key === 'End'
					? upper
					: e.key in steps
						? current + steps[e.key]
						: null;
		if (next === null) return;
		e.preventDefault();
		e.stopPropagation();
		const value = offsetToDate(Math.max(lower, Math.min(upper, next)));
		if (handle === 'start') onchange(value, end);
		else onchange(start, value);
	}

	// Handle sizes scale up on touch so the hit area is closer to 44×44 with the track padding
	function handleSize(type: 'start' | 'end'): number {
		if (isTouch) {
			if (dragging === type) return 28;
			if (hovered === type) return 26;
			return 24;
		}
		if (dragging === type) return 20;
		if (hovered === type) return 18;
		return 14;
	}

	function handleGlow(type: 'start' | 'end'): string {
		if (dragging === type) return '0 0 16px var(--color-bitcoin-glow-strong)';
		if (hovered === type) return '0 0 12px var(--color-bitcoin-glow-medium)';
		return '0 0 6px var(--color-bitcoin-glow-soft)';
	}

	function rangeGlow(): string {
		if (dragging === 'range') return '0 0 20px -2px var(--color-bitcoin-glow-strong)';
		if (hovered === 'range') return '0 0 16px -2px var(--color-bitcoin-glow-medium)';
		return '0 0 12px -2px var(--color-bitcoin-glow-soft)';
	}

	function rangeHeight(): number {
		if (isTouch) {
			if (dragging === 'range') return 12;
			if (hovered === 'range') return 10;
			return 8;
		}
		if (dragging === 'range') return 10;
		if (hovered === 'range') return 8;
		return 6;
	}

	function trackBgOpacity(): number {
		if (hovered || dragging) return 0.08;
		return 0.03;
	}

	// Track height scales for touch
	let trackHeight = $derived(isTouch ? 48 : 40);
	let trackCenter = $derived(trackHeight / 2);
</script>

<div class="space-y-2">
	<!-- Date labels -->
	<div
		class="flex justify-between text-[10px] font-[var(--font-mono)] uppercase tracking-wider transition-colors duration-150"
		style="color: {dragging ? 'var(--color-bitcoin)' : 'var(--color-muted)'};"
	>
		<span>{formatLabel(start)}</span>
		<span>{formatLabel(end)}</span>
	</div>

	<!-- Slider track -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		bind:this={track}
		class="relative cursor-pointer select-none rounded-control transition-colors duration-150"
		style="height: {trackHeight}px; background: rgba(255,255,255,{trackBgOpacity()});"
		onclick={handleTrackClick}
		onmouseenter={() => {
			if (!dragging) hovered = 'track';
		}}
		onmouseleave={() => {
			if (!dragging) hovered = null;
		}}
	>
		<!-- Background track line -->
		<div
			class="absolute left-2 right-2 h-[6px] rounded-full bg-white/5"
			style="top: {trackCenter - 3}px;"
		></div>

		<!-- Tick marks for month boundaries -->
		{#if totalDays > 0}
			{#each Array.from({ length: Math.ceil(totalDays / 30) }, (_, i) => i * 30) as tickOffset}
				{#if tickOffset > 0 && tickOffset < totalDays}
					<div
						class="absolute w-px h-[8px] transition-colors duration-150"
						style="left: {(tickOffset / totalDays) * 100}%; top: {trackCenter -
							4}px; background: rgba(255,255,255,{hovered || dragging ? 0.15 : 0.07});"
					></div>
				{/if}
			{/each}
		{/if}

		<!-- Selected range fill -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute rounded-full cursor-grab active:cursor-grabbing transition-all duration-100"
			style="
        left: {startPct}%;
        right: {100 - endPct}%;
        top: {trackCenter - rangeHeight() / 2}px;
        height: {rangeHeight()}px;
        background: linear-gradient(to right, var(--color-bitcoin-deep), var(--color-bitcoin));
        box-shadow: {rangeGlow()};
      "
			onpointerdown={(e) => handlePointerDown(e, 'range')}
			onmouseenter={() => {
				if (!dragging) hovered = 'range';
			}}
			onmouseleave={() => {
				if (!dragging) hovered = null;
			}}
			role="presentation"
		></div>

		<!-- Start handle -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute rounded-full bg-white border-2 cursor-ew-resize z-10 transition-all duration-100"
			style="
        left: calc({startPct}% - {handleSize('start') / 2}px);
        top: {trackCenter - handleSize('start') / 2}px;
        width: {handleSize('start')}px;
        height: {handleSize('start')}px;
        border-color: var(--color-bitcoin);
        box-shadow: {handleGlow('start')};
      "
			onpointerdown={(e) => handlePointerDown(e, 'start')}
			onkeydown={(e) => handleKey(e, 'start')}
			onmouseenter={() => {
				if (!dragging) hovered = 'start';
			}}
			onmouseleave={() => {
				if (!dragging) hovered = null;
			}}
			role="slider"
			tabindex="0"
			aria-label="Start date"
			aria-valuemin={0}
			aria-valuemax={endOffset}
			aria-valuenow={startOffset}
			aria-valuetext={formatLabel(start)}
		></div>

		<!-- End handle -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="absolute rounded-full bg-white border-2 cursor-ew-resize z-10 transition-all duration-100"
			style="
        left: calc({endPct}% - {handleSize('end') / 2}px);
        top: {trackCenter - handleSize('end') / 2}px;
        width: {handleSize('end')}px;
        height: {handleSize('end')}px;
        border-color: var(--color-bitcoin);
        box-shadow: {handleGlow('end')};
      "
			onpointerdown={(e) => handlePointerDown(e, 'end')}
			onkeydown={(e) => handleKey(e, 'end')}
			onmouseenter={() => {
				if (!dragging) hovered = 'end';
			}}
			onmouseleave={() => {
				if (!dragging) hovered = null;
			}}
			role="slider"
			tabindex="0"
			aria-label="End date"
			aria-valuemin={startOffset}
			aria-valuemax={totalDays}
			aria-valuenow={endOffset}
			aria-valuetext={formatLabel(end)}
		></div>
	</div>

	<!-- Absolute range labels -->
	<div
		class="flex justify-between text-[9px] font-[var(--font-mono)] text-white/20 uppercase tracking-wider"
	>
		<span>{formatLabel(min)}</span>
		<span>{formatLabel(max)}</span>
	</div>
</div>
