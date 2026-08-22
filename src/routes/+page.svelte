<script lang="ts">
	import { onMount } from 'svelte';
	import type { Task, DayCount, GroupBy, ChartMode } from '$lib/types.js';
	import { applyBaseFilters, applyViewFilters } from '$lib/data/filters.js';
	import { getPruneCutoff, mergeParsedData, pruneDeletedTasks } from '$lib/data/merge.js';
	import { PRIORITY_ORDER } from '$lib/data/parser.js';
	import { AGE_BAND_ORDER, AI_ORDER } from '$lib/data/calculator.js';
	import {
		avgDueToCompletion,
		calculateFlows,
		cancelRate,
		rollingAvgTotals,
		sampleDailyCounts,
		type FlowBucket
	} from '$lib/data/metrics.js';
	import type { ParsedData, TaskCache } from '$lib/types.js';
	import { buildEventsMap, getMinDate } from '$lib/data/events.js';
	import { calculateDailyCounts } from '$lib/data/calculator.js';
	import { DEFAULT_TIMEZONE, TIMEZONES, getCurrentDateStr } from '$lib/data/timezone.js';
	import { getPresetRange, PRESET_LABELS, type PresetLabel } from '$lib/data/presets.js';
	import { MARKERS } from '$lib/markers.js';
	import { loadPreferences, savePreferences } from '$lib/data/preferences.js';
	import TaskChart from '../components/TaskChart.svelte';
	import FlowChart from '../components/FlowChart.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import RangeSlider from '../components/RangeSlider.svelte';

	const DEFAULT_TAGS = [
		'Learning',
		'Chore',
		'Work',
		'Westport',
		'Social Planning',
		'Shopping',
		'Errand',
		'Finances'
	];

	const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
		{ value: 'tag', label: 'Tag' },
		{ value: 'priority', label: 'Priority' },
		{ value: 'project', label: 'Project' },
		{ value: 'age', label: 'Age' },
		{ value: 'ai', label: 'AI' }
	];

	// Sequential heat ramp, young → old (warm → cold as tasks go stale);
	// adjacent-pair CVD/normal separation validated against the dark surface.
	const AGE_BAND_COLORS: Record<string, string> = {
		'<1w': '#FDE047',
		'1w-1m': '#F97316',
		'1-3m': '#E11D48',
		'3-6m': '#A21CAF',
		'6m+': '#6366F1'
	};

	// AI Completed = green (like Completed), AI Ready = blue (queued), Manual = slate.
	const AI_COLORS: Record<string, string> = {
		'AI Completed': '#22C55E',
		'AI Ready': '#3B82F6',
		Manual: '#64748B'
	};

	const SLIDER_MIN = '2025-01-10';

	let allTasks: Task[] = $state([]);
	let allTags: string[] = $state([]);
	let allPriorities: string[] = $state(['High', 'Medium', 'Low', '(No Priority)']);
	let allProjects: string[] = $state(['(No Project)']);
	let tagColors: Record<string, string> = $state({});

	let timezone: string = $state(DEFAULT_TIMEZONE);
	const initial90D = getPresetRange('90D', DEFAULT_TIMEZONE);
	let activePreset: string = $state('90D');
	let dateStart: string = $state(initial90D.start);
	let dateEnd: string = $state(initial90D.end);
	let includeProjectTasks: boolean = $state(true);
	let includeCanceled: boolean = $state(false);
	let showMarkers: boolean = $state(true);
	let showLegacyTags: boolean = $state(false);
	let groupBy: GroupBy = $state('tag');
	let chartMode: ChartMode = $state('active');
	let flowBucket: FlowBucket = $state('day');

	const CHART_MODES: { value: ChartMode; label: string }[] = [
		{ value: 'active', label: 'Active' },
		{ value: 'flow', label: 'Flow' }
	];
	const FLOW_BUCKETS: { value: FlowBucket; label: string }[] = [
		{ value: 'day', label: 'Day' },
		{ value: 'week', label: 'Week' },
		{ value: 'month', label: 'Month' }
	];

	// Heroicon path data for the control triggers (icons skill: mono UI icons)
	const ICONS = {
		range:
			'M6.75 2.994v2.25m10.5-2.25v2.25m-14.252 13.5V7.491a2.25 2.25 0 0 1 2.25-2.25h13.5a2.25 2.25 0 0 1 2.25 2.25v11.251m-18 0a2.25 2.25 0 0 0 2.25 2.25h13.5a2.25 2.25 0 0 0 2.25-2.25m-18 0v-7.5a2.25 2.25 0 0 1 2.25-2.25h13.5a2.25 2.25 0 0 1 2.25 2.25v7.5m-6.75-6h2.25m-9 2.25h4.5m.002-2.25h.005v.006H12v-.006Zm-.001 4.5h.006v.006h-.006v-.005Zm-2.25.001h.005v.006H9.75v-.006Zm-2.25 0h.005v.005h-.006v-.005Zm6.75-2.247h.005v.005h-.005v-.005Zm0 2.247h.006v.006h-.006v-.006Zm2.25-2.248h.006V15H16.5v-.005Z',
		group:
			'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
		mode: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
		bucket:
			'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z',
		tz: 'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418',
		edits: 'M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
		sync: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99'
	};

	// Shared styling: shadcn triggers/buttons dressed in the app's control language
	const TRIGGER_CLASS =
		'h-auto gap-2 rounded-control border-border-default px-3 py-2 font-[var(--font-mono)] text-xs tracking-wider text-muted uppercase transition-all duration-150 hover:border-border-strong dark:bg-transparent dark:hover:bg-secondary/40';
	const CONTENT_CLASS = 'font-[var(--font-mono)] text-xs tracking-wider uppercase';
	const ACTION_BTN_CLASS =
		'h-auto gap-2 rounded-control border-border-default px-3 py-2 font-[var(--font-mono)] text-xs tracking-wider text-muted uppercase hover:border-bitcoin/40 hover:text-muted dark:bg-transparent dark:border-border-default dark:hover:bg-bitcoin/5';
	const CHIP_BTN_CLASS = 'h-auto gap-2 rounded-control px-3 py-2 dark:bg-transparent';

	let prefsLoaded = $state(false);

	let SLIDER_MAX = $derived.by(() => {
		// today + 14 days — gives a small future buffer without stretching the
		// slider so wide that short ranges (7D/30D) collapse to invisible slivers.
		const today = getCurrentDateStr(timezone);
		const [y, m, d] = today.split('-').map(Number);
		const dt = new Date(Date.UTC(y, m - 1, d + 14));
		return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
	});

	let baseTasks = $derived(applyBaseFilters(allTasks, includeCanceled));

	let isFullSyncing: boolean = $state(false);
	let isRefreshingToday: boolean = $state(false);

	let refreshError: string | null = $state(null);

	let filteredTasks = $derived(
		applyViewFilters(baseTasks, {
			includeLegacy: false,
			includeIncomplete: true,
			includeProjectTasks
		})
	);

	let allCategories = $derived.by(() => {
		switch (groupBy) {
			case 'tag':
				return allTags;
			case 'priority':
				return allPriorities;
			case 'project':
				return allProjects;
			case 'age':
				return [...AGE_BAND_ORDER];
			case 'ai':
				return [...AI_ORDER];
		}
	});

	let selectedCategories = $derived.by(() => {
		switch (groupBy) {
			case 'tag':
				return showLegacyTags
					? new Set(allTags)
					: new Set(DEFAULT_TAGS.filter((t) => allTags.includes(t)));
			case 'priority':
				return new Set(allPriorities);
			case 'project':
				return new Set(allProjects);
			case 'age':
				return new Set(AGE_BAND_ORDER);
			case 'ai':
				return new Set(AI_ORDER);
		}
	});

	let hiddenByDefault = $derived((groupBy as GroupBy) === 'project' ? ['(No Project)'] : []);

	let eventsMap = $derived(buildEventsMap(filteredTasks, timezone));
	let minDate = $derived(getMinDate(filteredTasks, timezone));

	let dailyCounts: DayCount[] = $derived(
		calculateDailyCounts({
			events: eventsMap,
			minDate,
			limitDate: SLIDER_MAX,
			groupBy,
			allCategories,
			selectedCategories,
			tz: timezone
		})
	);

	// Priorities keep their rank order (High → Low) and age bands their ramp
	// order (oldest at the bottom of the stack); alphabetical reads as a swap.
	let categories = $derived.by(() => {
		switch (groupBy) {
			case 'priority':
				return PRIORITY_ORDER.filter((p) => selectedCategories.has(p));
			case 'age':
				return AGE_BAND_ORDER.filter((b) => selectedCategories.has(b));
			case 'ai':
				return AI_ORDER.filter((c) => selectedCategories.has(c));
			default:
				return [...selectedCategories].sort();
		}
	});

	let totalActive = $derived.by(() => {
		if (dailyCounts.length === 0) return 0;
		const today = getCurrentDateStr(timezone);
		const todayEntry = dailyCounts.find((d) => d.date === today);
		if (todayEntry) return todayEntry.total as number;
		return dailyCounts[dailyCounts.length - 1].total as number;
	});

	let taskCount = $derived(filteredTasks.length);
	let projectCount = $derived(baseTasks.filter((t) => t.hasProject).length);

	const PRIORITY_COLORS: Record<string, string> = {
		High: 'red',
		Medium: 'yellow',
		Low: 'green',
		'(No Priority)': 'gray'
	};

	let chartColors = $derived.by((): Record<string, string> => {
		switch (groupBy) {
			case 'tag':
				return tagColors;
			case 'priority':
				return PRIORITY_COLORS;
			case 'project':
				return {};
			case 'age':
				return AGE_BAND_COLORS;
			case 'ai':
				return AI_COLORS;
		}
	});

	let flows = $derived(
		calculateFlows(filteredTasks, timezone, flowBucket, dateStart, dateEnd, groupBy)
	);
	// Sample the visible window so the current partial week/month keeps a bar
	// (sampling the full series would date it beyond the range and lose it).
	let avgTotals = $derived(rollingAvgTotals(dailyCounts));
	let avgDueToDone = $derived(avgDueToCompletion(filteredTasks, timezone));
	let canceledPct = $derived(cancelRate(allTasks));
	let displayCounts = $derived(
		sampleDailyCounts(
			dailyCounts.filter((d) => d.date >= dateStart && d.date <= dateEnd),
			flowBucket
		)
	);

	$effect(() => {
		// Recompute the active preset's range when timezone changes
		timezone;
		if (activePreset) {
			const range = getPresetRange(activePreset as PresetLabel, timezone);
			dateStart = range.start;
			dateEnd = range.end;
		}
	});

	// Persist preferences once loaded (skip the initial pre-load run)
	$effect(() => {
		// Subscribe to everything we want to persist
		const tz = timezone;
		const preset = activePreset;
		const start = dateStart;
		const end = dateEnd;
		const legacy = showLegacyTags;
		const projects = includeProjectTasks;
		const canceled = includeCanceled;
		const marks = showMarkers;
		const grp = groupBy;
		const mode = chartMode;
		if (!prefsLoaded) return;
		savePreferences({
			version: 1,
			timezone: tz,
			groupBy: grp,
			chartMode: mode,
			showLegacyTags: legacy,
			includeProjectTasks: projects,
			includeCanceled: canceled,
			showMarkers: marks,
			preset: (PRESET_LABELS as readonly string[]).includes(preset)
				? (preset as PresetLabel)
				: null,
			...(preset === '' ? { dateStart: start, dateEnd: end } : {})
		});
	});

	let syncProgress: number = $state(0);

	function applyParsed(d: ParsedData) {
		allTasks = d.tasks;
		allTags = d.allTags;
		allPriorities = d.allPriorities;
		allProjects = d.allProjects;
		tagColors = d.tagColors;
	}

	async function loadTasks() {
		refreshError = null;
		try {
			const res = await fetch('/api/tasks');
			if (!res.ok) {
				refreshError = `${res.status}`;
				return;
			}
			applyParsed((await res.json()) as TaskCache);
		} catch (e) {
			refreshError = (e as Error).message;
		}
	}

	async function fullSync() {
		isFullSyncing = true;
		refreshError = null;
		syncProgress = 0;
		try {
			let merged: ParsedData | null = null;
			let cursor: string | null = null;
			do {
				const qs: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
				const res = await fetch(`/api/refresh-chunk${qs}`, { method: 'POST' });
				if (!res.ok) {
					refreshError = `${res.status}`;
					return;
				}
				const { nextCursor, ...chunk } = (await res.json()) as ParsedData & {
					nextCursor: string | null;
				};
				merged = merged ? mergeParsedData(merged, chunk) : chunk;
				cursor = nextCursor;
				syncProgress += 1;
			} while (cursor);
			const cacheData: TaskCache = {
				lastFullRefreshAt: new Date().toISOString(),
				...merged!
			};
			const put = await fetch('/api/cache', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(cacheData)
			});
			if (!put.ok) {
				refreshError = `${put.status}`;
				return;
			}
			applyParsed(cacheData);
		} catch (e) {
			refreshError = (e as Error).message;
		} finally {
			isFullSyncing = false;
		}
	}

	async function refreshEdits() {
		isRefreshingToday = true;
		refreshError = null;
		try {
			// Server syncs from the cache's own last-edited high-water mark, so
			// this catches everything edited since the last sync — however long ago.
			const res = await fetch('/api/refresh', { method: 'POST' });
			if (!res.ok) {
				refreshError = `${res.status}`;
				return;
			}
			const meta = (await res.json()) as { needsFull: boolean };
			if (meta.needsFull) {
				await fullSync(); // empty cache bootstraps itself via the chunk loop
			} else {
				await loadTasks();
			}
		} catch (e) {
			refreshError = (e as Error).message;
		} finally {
			isRefreshingToday = false;
		}
	}

	// Edits sync + deletion sweep: pull all edits, fetch the set of page ids that
	// still exist in Notion (slim id-only queries), drop cached tasks not in it.
	async function pruneSync() {
		isFullSyncing = true;
		refreshError = null;
		syncProgress = 0;
		try {
			const res = await fetch('/api/refresh', { method: 'POST' });
			if (!res.ok) {
				refreshError = `${res.status}`;
				return;
			}
			const meta = (await res.json()) as { needsFull: boolean };
			if (meta.needsFull) {
				isFullSyncing = false;
				await fullSync(); // empty cache: nothing to prune, just bootstrap
				return;
			}

			const tasksRes = await fetch('/api/tasks');
			if (!tasksRes.ok) {
				refreshError = `${tasksRes.status}`;
				return;
			}
			const cacheData = (await tasksRes.json()) as TaskCache;

			// One cutoff for both the server-side sweep and the local prune, so the
			// two sides of the heuristic can never disagree.
			const cutoff = getPruneCutoff();
			const sweptIds = new Set<string>();
			let cursor: string | null = null;
			do {
				const cursorQs: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
				const r = await fetch(`/api/prune?cutoff=${encodeURIComponent(cutoff)}${cursorQs}`, {
					method: 'POST'
				});
				if (!r.ok) {
					refreshError = `${r.status}`;
					return;
				}
				const { ids, nextCursor } = (await r.json()) as {
					ids: string[];
					nextCursor: string | null;
				};
				for (const id of ids) sweptIds.add(id);
				cursor = nextCursor;
				syncProgress += 1;
			} while (cursor);

			// Guard: an empty sweep means something went wrong — never wipe the cache.
			if (sweptIds.size === 0) {
				refreshError = 'sweep returned no ids';
				return;
			}

			const pruned: TaskCache = {
				...cacheData,
				tasks: pruneDeletedTasks(cacheData.tasks, sweptIds, cutoff),
				lastFullRefreshAt: new Date().toISOString()
			};
			const put = await fetch('/api/cache', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(pruned)
			});
			if (!put.ok) {
				refreshError = `${put.status}`;
				return;
			}
			applyParsed(pruned);
		} catch (e) {
			refreshError = (e as Error).message;
		} finally {
			isFullSyncing = false;
		}
	}

	function handleSliderChange(start: string, end: string) {
		activePreset = '';
		dateStart = start;
		dateEnd = end;
	}

	onMount(async () => {
		// Apply stored preferences before kicking off the network refresh
		const stored = loadPreferences();
		if (stored) {
			timezone = stored.timezone;
			groupBy = stored.groupBy;
			chartMode = stored.chartMode ?? 'active';
			showLegacyTags = stored.showLegacyTags;
			includeProjectTasks = stored.includeProjectTasks;
			includeCanceled = stored.includeCanceled ?? false;
			showMarkers = stored.showMarkers ?? true;
			if (stored.preset !== null) {
				// Preset is a *rule* — re-anchor to today in the (possibly new) tz
				const range = getPresetRange(stored.preset, stored.timezone);
				activePreset = stored.preset;
				dateStart = range.start;
				dateEnd = range.end;
			} else if (stored.dateStart && stored.dateEnd) {
				activePreset = '';
				dateStart = stored.dateStart;
				dateEnd = stored.dateEnd;
			}
		}
		if (typeof location !== 'undefined' && location.hash === '#flow') chartMode = 'flow';
		prefsLoaded = true;

		await loadTasks(); // paint from R2 cache immediately, then pull edits
		// ponytail: page-load sync is edits-only (cheap, self-healing); the
		// deletion sweep and full sync stay manual via their buttons
		await refreshEdits();
	});
</script>

{#snippet controlIcon(d: string, cls: string = '')}
	<svg
		class="w-4 h-4 text-muted {cls}"
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

<!-- Background grid pattern -->
<div class="fixed inset-0 bg-grid pointer-events-none"></div>

<!-- Background glow blob (desktop only — overflows phones) -->
<div
	class="hidden sm:block fixed top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full pointer-events-none"
	style="background: radial-gradient(ellipse, var(--color-bitcoin-glow-soft) 0%, transparent 70%); filter: blur(80px);"
></div>

<!-- Mobile: exactly one viewport tall, no scrolling — the chart card flexes to fit.
     Desktop (sm+): normal document flow, unchanged. -->
<div
	class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-12 flex flex-col gap-6 sm:gap-10 h-dvh overflow-hidden sm:h-auto sm:overflow-visible"
>
	<!-- Header — title at the top always -->
	<header class="order-1">
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1
					class="font-[var(--font-heading)] text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-tight"
				>
					Task <span class="bg-gradient-to-r from-bitcoin to-gold bg-clip-text text-transparent"
						>Burndown</span
					>
				</h1>
				<p class="text-muted mt-2 font-[var(--font-body)] text-sm sm:text-base">
					Active task trends from Notion
				</p>
			</div>

			{#if refreshError}
				<div
					class="hidden sm:flex items-center gap-2 text-red-400 font-[var(--font-mono)] text-xs mt-2"
				>
					<span>Sync failed</span>
				</div>
			{/if}
		</div>
	</header>

	<!-- Stats — under header on desktop, at the bottom on mobile -->
	{#if baseTasks.length > 0}
		<section
			class="order-3 sm:order-2 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:items-center sm:gap-6 sm:-mt-4 sm:pt-6 sm:border-t sm:border-border-subtle"
		>
			<div>
				<span class="font-[var(--font-mono)] text-xl sm:text-2xl md:text-3xl font-medium text-white"
					>{totalActive}</span
				>
				<span class="text-muted text-xs font-[var(--font-mono)] uppercase tracking-wider ml-2"
					>active now</span
				>
			</div>
			<div class="hidden sm:block w-px h-6 bg-border-default"></div>
			<div>
				<span class="font-[var(--font-mono)] text-xl sm:text-2xl md:text-3xl font-medium text-white"
					>{taskCount}</span
				>
				<span class="text-muted text-xs font-[var(--font-mono)] uppercase tracking-wider ml-2"
					>total tracked</span
				>
			</div>
			<div class="hidden sm:block w-px h-6 bg-border-default"></div>
			<div>
				<span class="font-[var(--font-mono)] text-xl sm:text-2xl md:text-3xl font-medium text-white"
					>{allTags.length}</span
				>
				<span class="text-muted text-xs font-[var(--font-mono)] uppercase tracking-wider ml-2"
					>tags</span
				>
			</div>
			<div class="hidden sm:block w-px h-6 bg-border-default"></div>
			<div>
				<span class="font-[var(--font-mono)] text-xl sm:text-2xl md:text-3xl font-medium text-white"
					>{projectCount}</span
				>
				<span class="text-muted text-xs font-[var(--font-mono)] uppercase tracking-wider ml-2"
					>with projects</span
				>
			</div>
			{#if avgDueToDone !== null}
				<div class="hidden sm:block w-px h-6 bg-border-default"></div>
				<div>
					<span
						class="font-[var(--font-mono)] text-xl sm:text-2xl md:text-3xl font-medium text-white"
						>{avgDueToDone >= 0 ? '+' : ''}{avgDueToDone.toFixed(1)}d</span
					>
					<span class="text-muted text-xs font-[var(--font-mono)] uppercase tracking-wider ml-2"
						>due → done</span
					>
				</div>
			{/if}
			{#if canceledPct !== null}
				<div class="hidden sm:block w-px h-6 bg-border-default"></div>
				<div>
					<span
						class="font-[var(--font-mono)] text-xl sm:text-2xl md:text-3xl font-medium text-white"
						>{canceledPct.toFixed(0)}%</span
					>
					<span class="text-muted text-xs font-[var(--font-mono)] uppercase tracking-wider ml-2"
						>canceled</span
					>
				</div>
			{/if}
		</section>
	{/if}

	<!-- Chart card — between header and stats on mobile, after stats on desktop -->
	<div
		class="order-2 sm:order-3 rounded-card border border-border-default bg-surface p-2.5 sm:p-6 flex flex-col flex-1 min-h-0 sm:flex-none"
		style="box-shadow: 0 0 60px -20px var(--color-bitcoin-glow-soft);"
	>
		<!-- Controls — two rows on mobile, one row on desktop. Order-3 on mobile so chart shows first. -->
		<div
			class="order-3 sm:order-1 flex flex-col gap-2 mt-3 sm:mt-0 sm:mb-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
		>
			<!-- Left: everything except the sync actions -->
			<div class="flex items-center flex-wrap gap-2 sm:gap-3">
				<Select.Root type="single" bind:value={activePreset}>
					<Select.Trigger class={TRIGGER_CLASS} title="Date range">
						{@render controlIcon(ICONS.range)}
						<span>{activePreset === '' ? 'Custom' : activePreset}</span>
					</Select.Trigger>
					<Select.Content class={CONTENT_CLASS}>
						{#each PRESET_LABELS as label}
							<Select.Item value={label} {label} />
						{/each}
					</Select.Content>
				</Select.Root>

				<Select.Root type="single" value={groupBy} onValueChange={(v) => (groupBy = v as GroupBy)}>
					<Select.Trigger class={TRIGGER_CLASS} title="Group by">
						{@render controlIcon(ICONS.group)}
						<span>{GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}</span>
					</Select.Trigger>
					<Select.Content class={CONTENT_CLASS}>
						{#each GROUP_BY_OPTIONS as option}
							<Select.Item value={option.value} label={option.label} />
						{/each}
					</Select.Content>
				</Select.Root>

				<Select.Root
					type="single"
					value={chartMode}
					onValueChange={(v) => (chartMode = v as ChartMode)}
				>
					<Select.Trigger class={TRIGGER_CLASS} title="Chart mode">
						{@render controlIcon(ICONS.mode)}
						<span>{CHART_MODES.find((m) => m.value === chartMode)?.label}</span>
					</Select.Trigger>
					<Select.Content class={CONTENT_CLASS}>
						{#each CHART_MODES as mode}
							<Select.Item value={mode.value} label={mode.label} />
						{/each}
					</Select.Content>
				</Select.Root>

				<Select.Root
					type="single"
					value={flowBucket}
					onValueChange={(v) => (flowBucket = v as FlowBucket)}
				>
					<Select.Trigger class={TRIGGER_CLASS} title="Time bucket">
						{@render controlIcon(ICONS.bucket)}
						<span>{FLOW_BUCKETS.find((b) => b.value === flowBucket)?.label}</span>
					</Select.Trigger>
					<Select.Content class={CONTENT_CLASS}>
						{#each FLOW_BUCKETS as b}
							<Select.Item value={b.value} label={b.label} />
						{/each}
					</Select.Content>
				</Select.Root>

				<Select.Root type="single" bind:value={timezone}>
					<Select.Trigger class={TRIGGER_CLASS} title="Timezone">
						{@render controlIcon(ICONS.tz)}
						<span>{TIMEZONES.find((t) => t.id === timezone)?.label}</span>
					</Select.Trigger>
					<Select.Content class={CONTENT_CLASS}>
						{#each TIMEZONES as tz}
							<Select.Item value={tz.id} label={tz.label} />
						{/each}
					</Select.Content>
				</Select.Root>

				{#if groupBy === 'tag'}
					<Button
						variant="outline"
						onclick={() => (showLegacyTags = !showLegacyTags)}
						class={CHIP_BTN_CLASS}
						style={showLegacyTags
							? 'border-color: var(--color-bitcoin-glow-medium); background: var(--color-bitcoin-glow-soft);'
							: 'border-color: var(--color-border-default); background: transparent;'}
						title="Include legacy tags"
					>
						<div
							class="size-1.5 rounded-full transition-colors duration-150"
							style="background: {showLegacyTags
								? 'var(--color-bitcoin)'
								: 'var(--color-border-strong)'};"
						></div>
						<span
							class="text-xs font-[var(--font-mono)] uppercase tracking-wider"
							style="color: {showLegacyTags ? 'var(--color-bitcoin)' : 'var(--color-muted)'};"
							>Legacy</span
						>
					</Button>
				{/if}

				{#if groupBy !== 'project'}
					<Button
						variant="outline"
						onclick={() => (includeProjectTasks = !includeProjectTasks)}
						class={CHIP_BTN_CLASS}
						style={includeProjectTasks
							? 'border-color: var(--color-bitcoin-glow-medium); background: var(--color-bitcoin-glow-soft);'
							: 'border-color: var(--color-border-default); background: transparent;'}
						title="Include project tasks"
					>
						<div
							class="size-1.5 rounded-full transition-colors duration-150"
							style="background: {includeProjectTasks
								? 'var(--color-bitcoin)'
								: 'var(--color-border-strong)'};"
						></div>
						<span
							class="text-xs font-[var(--font-mono)] uppercase tracking-wider"
							style="color: {includeProjectTasks ? 'var(--color-bitcoin)' : 'var(--color-muted)'};"
							>Projects</span
						>
					</Button>
				{/if}

				<Button
					variant="outline"
					onclick={() => (includeCanceled = !includeCanceled)}
					class={CHIP_BTN_CLASS}
					style={includeCanceled
						? 'border-color: var(--color-bitcoin-glow-medium); background: var(--color-bitcoin-glow-soft);'
						: 'border-color: var(--color-border-default); background: transparent;'}
					title="Include canceled tasks"
				>
					<div
						class="size-1.5 rounded-full transition-colors duration-150"
						style="background: {includeCanceled
							? 'var(--color-bitcoin)'
							: 'var(--color-border-strong)'};"
					></div>
					<span
						class="text-xs font-[var(--font-mono)] uppercase tracking-wider"
						style="color: {includeCanceled ? 'var(--color-bitcoin)' : 'var(--color-muted)'};"
						>Canceled</span
					>
				</Button>

				<Button
					variant="outline"
					onclick={() => (showMarkers = !showMarkers)}
					class={CHIP_BTN_CLASS}
					style={showMarkers
						? 'border-color: var(--color-bitcoin-glow-medium); background: var(--color-bitcoin-glow-soft);'
						: 'border-color: var(--color-border-default); background: transparent;'}
					title="Show event markers"
				>
					<div
						class="size-1.5 rounded-full transition-colors duration-150"
						style="background: {showMarkers
							? 'var(--color-bitcoin)'
							: 'var(--color-border-strong)'};"
					></div>
					<span
						class="text-xs font-[var(--font-mono)] uppercase tracking-wider"
						style="color: {showMarkers ? 'var(--color-bitcoin)' : 'var(--color-muted)'};"
						>Markers</span
					>
				</Button>
			</div>

			<!-- Right side: sync actions only -->
			<div class="flex items-center flex-wrap gap-2 sm:gap-3">
				<Button
					variant="outline"
					onclick={refreshEdits}
					disabled={isRefreshingToday || isFullSyncing}
					class={ACTION_BTN_CLASS}
					title="Fetch all tasks edited since the last sync"
				>
					{@render controlIcon(ICONS.edits, isRefreshingToday ? 'animate-spin' : '')}
					<span>{isRefreshingToday ? 'Syncing' : 'Edits'}</span>
				</Button>

				<Button
					variant="outline"
					onclick={pruneSync}
					disabled={isFullSyncing || isRefreshingToday}
					class={ACTION_BTN_CLASS}
					title="Fetch edits and remove deleted tasks (id sweep, no full re-fetch)"
				>
					{@render controlIcon(ICONS.sync, isFullSyncing ? 'animate-spin' : '')}
					<span>{isFullSyncing ? `Sync ${syncProgress}` : 'Sync'}</span>
				</Button>
			</div>
		</div>

		<!-- Range slider — between controls and chart on desktop; between controls and stats on mobile -->
		<div class="order-2 sm:order-2 mt-3 mb-0 sm:mt-0 sm:mb-4 px-1">
			<RangeSlider
				min={SLIDER_MIN}
				max={SLIDER_MAX}
				start={dateStart}
				end={dateEnd}
				onchange={handleSliderChange}
			/>
		</div>

		<!-- Chart — top on mobile, bottom on desktop -->
		{#if baseTasks.length === 0}
			<div
				class="order-1 sm:order-3 flex-1 min-h-0 sm:flex-none sm:h-[var(--chart-height-tablet)] flex items-center justify-center"
			>
				<div class="text-center">
					<div class="loader mx-auto"></div>
					<p class="mt-4 text-muted font-[var(--font-mono)] text-sm">Loading task data...</p>
				</div>
			</div>
		{:else}
			<div
				class="order-1 sm:order-3 flex-1 min-h-0 sm:flex-none sm:h-[var(--chart-height-tablet)] lg:h-[var(--chart-height-desktop)]"
			>
				{#if chartMode === 'flow'}
					<FlowChart
						{flows}
						bucket={flowBucket}
						{categories}
						colorMap={chartColors}
						dateRange={{ start: dateStart, end: dateEnd }}
						{hiddenByDefault}
					/>
				{:else}
					<TaskChart
						dailyCounts={displayCounts}
						{categories}
						bucket={flowBucket}
						dateRange={{ start: dateStart, end: dateEnd }}
						tagColors={chartColors}
						{hiddenByDefault}
						averages={avgTotals}
						markers={showMarkers ? MARKERS : []}
					/>
				{/if}
			</div>
		{/if}
	</div>
</div>
