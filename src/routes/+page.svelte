<script lang="ts">
	import { fullSync as syncFullCache } from '$lib/data/full-sync.js';
	import { onMount } from 'svelte';
	import { readDashboard } from '$lib/offline';
	import dayjs from 'dayjs';
	import type { Task, DayCount, GroupBy, ChartMode } from '$lib/types.js';
	import {
		applyBaseFilters,
		applyViewFilters,
		PROJECT_KINDS,
		type ProjectKind
	} from '$lib/data/filters.js';
	import { getCategories } from '$lib/data/calculator.js';
	import {
		avgDueToCompletion,
		calculateCompletions,
		cancelRate,
		sampleDailyCounts,
		tasksInWindow,
		tasksResolvedIn,
		type FlowBucket
	} from '$lib/data/metrics.js';
	import type { ParsedData, TaskCache } from '$lib/types.js';
	import { buildEventsMap, getMinDate } from '$lib/data/events.js';
	import { calculateDailyCounts } from '$lib/data/calculator.js';
	import {
		DEVICE_TIMEZONE,
		TIMEZONES,
		getCurrentDateStr,
		type DayZone
	} from '$lib/data/timezone.js';
	import { getPresetRange, PRESET_LABELS, type PresetLabel } from '$lib/data/presets.js';
	import { parseMarkers, type ChartMarker } from '$lib/markers.js';
	import { parseSettings } from '$lib/settings.js';
	import { loadPreferences, savePreferences } from '$lib/data/preferences.js';
	import TaskChart from '../components/TaskChart.svelte';
	import RateChart from '../components/RateChart.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import RangeSlider from '../components/RangeSlider.svelte';
	import MarkerEditor from '../components/MarkerEditor.svelte';

	const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
		{ value: 'tag', label: 'Tag' },
		{ value: 'priority', label: 'Priority' },
		{ value: 'project', label: 'Project' },
		{ value: 'status', label: 'Status' },
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

	// AI Completed = green (like Completed), everything else slate.
	const AI_COLORS: Record<string, string> = {
		'AI Completed': '#22C55E',
		Manual: '#64748B'
	};

	const SLIDER_MIN = '2025-01-10';

	let allTasks: Task[] = $state([]);
	let allTags: string[] = $state([]);
	let allPriorities: string[] = $state(['High', 'Medium', 'Low', '(No Priority)']);
	let allProjects: string[] = $state(['(No Project)']);
	let tagColors: Record<string, string> = $state({});

	const DEVICE_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const TIMEZONE_OPTIONS = [
		{ id: DEVICE_TIMEZONE, label: `This device (${DEVICE_ZONE})` },
		...TIMEZONES
	];
	let timezone: string = $state(DEVICE_TIMEZONE);
	let timezoneLabel = $derived(TIMEZONE_OPTIONS.find((t) => t.id === timezone)?.label);
	// Shared across devices via /api/settings: minutes after midnight a day begins.
	let dayStartMinutes = $state(0);
	const DAY_START_OPTIONS = Array.from({ length: 24 }, (_, h) => h * 60);
	const clock = (m: number) =>
		`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
	// Every date computation counts days in this zone, from the shared day start.
	let zone: DayZone = $derived({
		tz: timezone === DEVICE_TIMEZONE ? DEVICE_ZONE : timezone,
		dayStart: dayStartMinutes
	});
	const initial90D = getPresetRange('90D', DEVICE_ZONE);
	let activePreset: string = $state('90D');
	let dateStart: string = $state(initial90D.start);
	let dateEnd: string = $state(initial90D.end);
	// The project lens is the list of kinds currently shown. Deselecting the
	// last entry snaps back to all (nothing selected must never render nothing).
	let projectKinds: ProjectKind[] = $state([...PROJECT_KINDS]);
	let includeCanceled: boolean = $state(false);
	let showCompleted: boolean = $state(true);
	let showMarkers: boolean = $state(true);
	let markers: ChartMarker[] = $state([]);
	let groupBy: GroupBy = $state('tag');

	const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
		project: 'With project',
		none: 'Without project'
	};

	/** Trigger text for a two-kind lens: "<name>: all" or the one kind shown. */
	function lensLabel<K extends string>(name: string, shown: K[], labels: Record<K, string>) {
		return shown.length === Object.keys(labels).length ? `${name}: all` : labels[shown[0]];
	}
	/** Multi-select change handler that snaps an empty pick back to every kind. */
	function pickKinds<K extends string>(all: readonly K[], v: string[]): K[] {
		const picked = all.filter((k) => v.includes(k));
		return picked.length ? picked : [...all];
	}
	let chartMode: ChartMode = $state('active');
	let flowBucket: FlowBucket = $state('day');

	const CHART_MODES: { value: ChartMode; label: string }[] = [
		{ value: 'active', label: 'Active' },
		{ value: 'rate', label: 'Rate' }
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
		mode: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
		group:
			'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z',
		projects:
			'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z',
		bucket:
			'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z',
		tz: 'M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418',
		dayStart:
			'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
		sync: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99'
	};

	// Shared styling: shadcn triggers/buttons dressed in the app's control language
	const TRIGGER_CLASS =
		'h-auto gap-2 rounded-control border-border-default px-3 py-2 font-[var(--font-mono)] text-xs tracking-wider text-muted uppercase transition-all duration-150 hover:border-border-strong dark:bg-transparent dark:hover:bg-secondary/40';
	const CONTENT_CLASS = 'font-[var(--font-mono)] text-xs tracking-wider uppercase';
	const ACTION_BTN_CLASS =
		'h-auto gap-2 rounded-control border-border-default px-3 py-2 font-[var(--font-mono)] text-xs tracking-wider text-muted uppercase hover:border-bitcoin/40 hover:text-muted dark:bg-transparent dark:border-border-default dark:hover:bg-bitcoin/5';
	const CHIP_BTN_CLASS = 'h-auto gap-2 rounded-control px-3 py-2 dark:bg-transparent';
	// A lens that is actively narrowing lights up like the old chips did
	const LENS_ON_STYLE =
		'border-color: var(--color-bitcoin-glow-medium); background: var(--color-bitcoin-glow-soft); color: var(--color-bitcoin);';

	let prefsLoaded = $state(false);

	let SLIDER_MAX = $derived.by(() => {
		// today + 14 days — gives a small future buffer without stretching the
		// slider so wide that short ranges (7D/30D) collapse to invisible slivers.
		const today = getCurrentDateStr(zone);
		const [y, m, d] = today.split('-').map(Number);
		const dt = new Date(Date.UTC(y, m - 1, d + 14));
		return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
	});

	let baseTasks = $derived(applyBaseFilters(allTasks, includeCanceled));

	let isFullSyncing: boolean = $state(false);
	let isRefreshingToday: boolean = $state(false);

	let refreshError: string | null = $state(null);
	let savedAt = $state<string | null>(null);
	let tasksLoaded = $state(false);

	let filteredTasks = $derived(applyViewFilters(baseTasks, { projectKinds }));

	// Every value in the data counts (a new tag or status included); the legend
	// hides series per device without changing the counts.
	let categories = $derived(
		getCategories(groupBy, {
			tasks: allTasks,
			allTags,
			allPriorities,
			allProjects,
			tagColors
		})
	);

	let hiddenByDefault = $derived((groupBy as GroupBy) === 'project' ? ['(No Project)'] : []);

	let eventsMap = $derived(buildEventsMap(filteredTasks, zone));
	let minDate = $derived(getMinDate(filteredTasks, zone));

	let dailyCounts: DayCount[] = $derived(
		calculateDailyCounts({
			events: eventsMap,
			minDate,
			limitDate: SLIDER_MAX,
			groupBy,
			allCategories: categories,
			selectedCategories: new Set(categories),
			tz: zone
		})
	);

	// Header stats follow the slider window: active = open count on the window's
	// last day, the rest count tasks that were open (or resolved) inside it.
	let totalActive = $derived.by(() => {
		let last: DayCount | undefined;
		for (const d of dailyCounts) if (d.date <= dateEnd) last = d;
		return (last?.total as number | undefined) ?? 0;
	});
	let activeLabel = $derived(
		dateEnd >= getCurrentDateStr(zone) ? 'active now' : `active ${dayjs(dateEnd).format('MMM D')}`
	);
	let windowTasks = $derived(tasksInWindow(filteredTasks, zone, dateStart, dateEnd));
	let taskCount = $derived(windowTasks.length);
	let projectCount = $derived(windowTasks.filter((t) => t.hasProject).length);
	let tagCount = $derived(new Set(windowTasks.flatMap((t) => t.tags)).size);

	const PRIORITY_COLORS: Record<string, string> = {
		High: 'red',
		Medium: 'yellow',
		Low: 'green',
		'(No Priority)': 'gray'
	};

	// The source palette's status colors (Notion names, like the priorities).
	const STATUS_COLORS: Record<string, string> = {
		'To Do': 'red',
		'In Progress': 'blue',
		Completed: 'green',
		Canceled: 'gray'
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
			case 'status':
				return STATUS_COLORS;
		}
	});

	let completions = $derived(
		calculateCompletions(filteredTasks, zone, flowBucket, dateStart, dateEnd)
	);
	let avgDueToDone = $derived(
		avgDueToCompletion(tasksResolvedIn(filteredTasks, zone, dateStart, dateEnd), zone)
	);
	// Cancel rate needs the canceled tasks the Canceled chip normally hides
	let canceledPct = $derived(
		cancelRate(
			tasksResolvedIn(
				applyViewFilters(applyBaseFilters(allTasks, true), { projectKinds }),
				zone,
				dateStart,
				dateEnd
			)
		)
	);
	// Sample the visible window so the current partial week/month keeps a bar
	// (sampling the full series would date it beyond the range and lose it).
	let displayCounts = $derived(
		sampleDailyCounts(
			dailyCounts.filter((d) => d.date >= dateStart && d.date <= dateEnd),
			flowBucket
		)
	);

	$effect(() => {
		// Recompute the active preset's range when the zone or day start changes
		const z = zone;
		if (activePreset) {
			const range = getPresetRange(activePreset as PresetLabel, z);
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
		const projects = projectKinds;
		const canceled = includeCanceled;
		const done = showCompleted;
		const marks = showMarkers;
		const grp = groupBy;
		const mode = chartMode;
		const bucket = flowBucket;
		if (!prefsLoaded) return;
		savePreferences({
			version: 2,
			timezone: tz,
			groupBy: grp,
			chartMode: mode,
			flowBucket: bucket,
			projectKinds: projects,
			includeCanceled: canceled,
			showCompleted: done,
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

	async function loadMarkers(refresh = false) {
		try {
			const result = await readDashboard<unknown>('/api/markers', fetch, { refresh });
			markers = parseMarkers(result.data);
		} catch {
			// ponytail: markers are decoration; a failed load just draws none
		}
	}

	async function loadSettings(refresh = false) {
		try {
			const result = await readDashboard<unknown>('/api/settings', fetch, { refresh });
			dayStartMinutes = parseSettings(result.data).dayStartMinutes;
		} catch {
			// ponytail: keeps the current day start; the next load retries
		}
	}

	async function saveDayStart(value: string) {
		const previous = dayStartMinutes;
		dayStartMinutes = Number(value);
		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ dayStartMinutes })
			});
			if (!res.ok) throw new Error(`${res.status}`);
			void loadSettings(true); // refresh the offline snapshot
		} catch (e) {
			dayStartMinutes = previous;
			refreshError = `day start not saved (${(e as Error).message})`;
		}
	}

	async function loadTasks(refresh = false) {
		refreshError = null;
		try {
			const result = await readDashboard<TaskCache>('/api/tasks', fetch, { refresh });
			applyParsed(result.data);
			savedAt = result.savedAt;
		} catch (e) {
			refreshError = (e as Error).message;
		} finally {
			tasksLoaded = true;
		}
	}

	async function fullSync() {
		isFullSyncing = true;
		refreshError = null;
		syncProgress = 0;
		try {
			const cacheData = await syncFullCache(fetch, () => {
				syncProgress += 1;
			});
			applyParsed(cacheData);
			await loadTasks(true);
		} catch (e) {
			refreshError = (e as Error).message;
		} finally {
			isFullSyncing = false;
		}
	}

	async function syncTasks() {
		isRefreshingToday = true;
		refreshError = null;
		try {
			// Soma pulls new tasks, edits, tombstones, and project changes from its cursor.
			const res = await fetch('/api/refresh', { method: 'POST' });
			if (!res.ok) {
				refreshError = `${res.status}`;
				return;
			}
			const meta = (await res.json()) as { needsFull: boolean };
			if (meta.needsFull) {
				await fullSync(); // empty cache bootstraps itself via the chunk loop
			} else {
				await loadTasks(true);
			}
		} catch (e) {
			refreshError = (e as Error).message;
		} finally {
			isRefreshingToday = false;
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
			projectKinds = pickKinds(PROJECT_KINDS, stored.projectKinds ?? []);
			includeCanceled = stored.includeCanceled ?? false;
			showCompleted = stored.showCompleted ?? true;
			showMarkers = stored.showMarkers ?? true;
			chartMode = stored.chartMode ?? 'active';
			flowBucket = stored.flowBucket ?? 'day';
			if (stored.preset !== null) {
				// Preset is a *rule* — re-anchor to today in the (possibly new) tz
				const range = getPresetRange(stored.preset, zone);
				activePreset = stored.preset;
				dateStart = range.start;
				dateEnd = range.end;
			} else if (stored.dateStart && stored.dateEnd) {
				activePreset = '';
				dateStart = stored.dateStart;
				dateEnd = stored.dateEnd;
			}
		}
		prefsLoaded = true;

		void loadMarkers();
		void loadSettings();
		await loadTasks(); // paint from R2 cache immediately, then pull edits
		// Page load uses the same incremental sync as the Sync button.
		if (navigator.onLine && !savedAt) await syncTasks();
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
					Active task trends over time
				</p>
			</div>

			{#if refreshError}
				<div
					role="alert"
					class="flex items-center gap-2 text-red-400 font-[var(--font-mono)] text-xs mt-2"
				>
					<span>Sync failed: {refreshError}</span>
				</div>
			{/if}
		</div>
		{#if savedAt}<p class="text-xs text-muted mt-2" role="status">
				Showing saved data from {new Date(savedAt).toLocaleString()}.
				<a href="/?online=1" data-sveltekit-reload class="underline">Reconnect</a>
			</p>{/if}
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
					>{activeLabel}</span
				>
			</div>
			<div class="hidden sm:block w-px h-6 bg-border-default"></div>
			<div>
				<span class="font-[var(--font-mono)] text-xl sm:text-2xl md:text-3xl font-medium text-white"
					>{taskCount}</span
				>
				<span class="text-muted text-xs font-[var(--font-mono)] uppercase tracking-wider ml-2"
					>tracked</span
				>
			</div>
			<div class="hidden sm:block w-px h-6 bg-border-default"></div>
			<div>
				<span class="font-[var(--font-mono)] text-xl sm:text-2xl md:text-3xl font-medium text-white"
					>{tagCount}</span
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
						<!-- Phones get the short form so the day start fits on the same row -->
						<span class="sm:hidden">{timezone === DEVICE_TIMEZONE ? 'Device' : timezoneLabel}</span>
						<span class="hidden sm:inline">{timezoneLabel}</span>
					</Select.Trigger>
					<Select.Content class={CONTENT_CLASS}>
						{#each TIMEZONE_OPTIONS as tz}
							<Select.Item value={tz.id} label={tz.label} />
						{/each}
					</Select.Content>
				</Select.Root>

				<Select.Root type="single" value={String(dayStartMinutes)} onValueChange={saveDayStart}>
					<Select.Trigger class={TRIGGER_CLASS} title="Day starts at">
						{@render controlIcon(ICONS.dayStart)}
						<span><span class="hidden sm:inline">Day starts</span> {clock(dayStartMinutes)}</span>
					</Select.Trigger>
					<Select.Content class={CONTENT_CLASS}>
						{#each DAY_START_OPTIONS as m}
							<Select.Item value={String(m)} label={clock(m)} />
						{/each}
					</Select.Content>
				</Select.Root>

				{#if groupBy !== 'project'}
					<Select.Root
						type="multiple"
						bind:value={() => projectKinds, (v) => (projectKinds = pickKinds(PROJECT_KINDS, v))}
					>
						<Select.Trigger
							class={TRIGGER_CLASS}
							style={projectKinds.length < PROJECT_KINDS.length ? LENS_ON_STYLE : ''}
							title="Which tasks count: with a project, without, or both"
						>
							{@render controlIcon(ICONS.projects)}
							<span>{lensLabel('Projects', projectKinds, PROJECT_KIND_LABELS)}</span>
						</Select.Trigger>
						<Select.Content class={CONTENT_CLASS}>
							{#each PROJECT_KINDS as kind}
								<Select.Item value={kind} label={PROJECT_KIND_LABELS[kind]} />
							{/each}
						</Select.Content>
					</Select.Root>
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
					onclick={() => (showCompleted = !showCompleted)}
					class={CHIP_BTN_CLASS}
					style={showCompleted
						? 'border-color: var(--color-bitcoin-glow-medium); background: var(--color-bitcoin-glow-soft);'
						: 'border-color: var(--color-border-default); background: transparent;'}
					title="Cap each bar with the day's same-day tasks (created and completed that day — invisible to the open count)"
				>
					<div
						class="size-1.5 rounded-full transition-colors duration-150"
						style="background: {showCompleted
							? 'var(--color-bitcoin)'
							: 'var(--color-border-strong)'};"
					></div>
					<span
						class="text-xs font-[var(--font-mono)] uppercase tracking-wider"
						style="color: {showCompleted ? 'var(--color-bitcoin)' : 'var(--color-muted)'};"
						>Same-day</span
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
				<MarkerEditor
					{markers}
					today={getCurrentDateStr(zone)}
					onsaved={(m) => {
						markers = m;
						void loadMarkers(true);
					}}
				/>
			</div>

			<!-- Right side: sync actions only -->
			<div class="flex items-center flex-wrap gap-2 sm:gap-3">
				<Button
					variant="outline"
					onclick={syncTasks}
					disabled={isFullSyncing || isRefreshingToday}
					class={ACTION_BTN_CLASS}
					title="Sync new tasks, changes, deletions, and project renames"
				>
					{@render controlIcon(
						ICONS.sync,
						isFullSyncing || isRefreshingToday ? 'animate-spin' : ''
					)}
					<span
						>{isFullSyncing ? `Sync ${syncProgress}` : isRefreshingToday ? 'Syncing' : 'Sync'}</span
					>
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
					{#if !tasksLoaded}
						<div class="loader mx-auto"></div>
						<p class="mt-4 text-muted font-[var(--font-mono)] text-sm">Loading task data...</p>
					{:else}
						<p class="text-muted text-sm">
							{refreshError
								? 'Task data is unavailable. Check your connection and try again.'
								: 'No tasks to show.'}
						</p>
						<a href="/?online=1" data-sveltekit-reload class="text-sm underline">Reconnect</a>
					{/if}
				</div>
			</div>
		{:else}
			<div
				class="order-1 sm:order-3 flex-1 min-h-0 sm:flex-none sm:h-[var(--chart-height-tablet)] lg:h-[var(--chart-height-desktop)]"
			>
				{#if chartMode === 'rate'}
					<RateChart
						{completions}
						bucket={flowBucket}
						dateRange={{ start: dateStart, end: dateEnd }}
						showSameDay={showCompleted}
						markers={showMarkers ? markers : []}
					/>
				{:else}
					<TaskChart
						dailyCounts={displayCounts}
						{categories}
						{groupBy}
						bucket={flowBucket}
						dateRange={{ start: dateStart, end: dateEnd }}
						tagColors={chartColors}
						{hiddenByDefault}
						avgSource={dailyCounts}
						markers={showMarkers ? markers : []}
						{completions}
						{showCompleted}
					/>
				{/if}
			</div>
		{/if}
	</div>
</div>
