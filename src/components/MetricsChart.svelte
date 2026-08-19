<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { GroupBy, Task } from '$lib/types.js';
	import {
		calculateFlows,
		pickFlowBucket,
		type DayMetrics,
		type FlowBucket
	} from '$lib/data/metrics.js';
	import { getSeriesColor } from '$lib/colors.js';

	interface Props {
		metrics: DayMetrics[];
		tasks: Task[];
		tz: string;
		groupBy: GroupBy;
		categories: string[];
		colorMap: Record<string, string>;
		dateRange: { start: string; end: string };
	}

	let { metrics, tasks, tz, groupBy, categories, colorMap, dateRange }: Props = $props();

	type Tab = 'age' | 'flow';
	const TABS: { value: Tab; label: string }[] = [
		{ value: 'age', label: 'Age' },
		{ value: 'flow', label: 'Flow' }
	];
	function initialTab(): Tab {
		if (typeof location !== 'undefined' && location.hash === '#flow') return 'flow';
		return 'age';
	}
	let tab: Tab = $state(initialTab());

	const BUCKETS: { value: FlowBucket; label: string }[] = [
		{ value: 'day', label: 'Day' },
		{ value: 'week', label: 'Week' },
		{ value: 'month', label: 'Month' }
	];
	let bucketOverride: FlowBucket | null = $state(null);
	let bucket: FlowBucket = $derived(
		bucketOverride ?? pickFlowBucket(dateRange.start, dateRange.end)
	);
	let flows = $derived(calculateFlows(tasks, tz, bucket, dateRange.start, dateRange.end, groupBy));

	let canvas: HTMLCanvasElement;
	let chart: any = null;
	let ChartJS: any = null;

	const GRID = { color: 'rgba(30, 41, 59, 0.3)', lineWidth: 0.5 };
	const TICKS = { color: '#94A3B8', font: { family: 'JetBrains Mono', size: 10 } };
	const LEGEND_LABELS = {
		color: '#94A3B8',
		font: { family: 'JetBrains Mono', size: 11 },
		boxWidth: 12,
		boxHeight: 12,
		padding: 16,
		useBorderRadius: true,
		borderRadius: 2
	};
	const TOOLTIP = {
		mode: 'index' as const,
		intersect: false,
		backgroundColor: 'rgba(15, 17, 21, 0.95)',
		borderColor: 'rgba(247, 147, 26, 0.3)',
		borderWidth: 1,
		titleColor: '#FFFFFF',
		bodyColor: '#94A3B8',
		titleFont: { family: 'Space Grotesk', size: 13, weight: '600' as const },
		bodyFont: { family: 'JetBrains Mono', size: 11 },
		footerColor: '#FFFFFF',
		footerFont: { family: 'JetBrains Mono', size: 12, weight: 'bold' as const },
		padding: 12,
		cornerRadius: 8
	};

	function buildAgeConfig() {
		const visible = metrics.filter((d) => d.date >= dateRange.start && d.date <= dateRange.end);
		const line = (label: string, data: { x: string; y: number | null }[], hex: string) => ({
			label,
			data,
			borderColor: hex,
			backgroundColor: hex,
			borderWidth: 2,
			pointRadius: 0,
			pointHitRadius: 8,
			spanGaps: false,
			tension: 0.2
		});
		return {
			type: 'line' as const,
			data: {
				datasets: [
					line(
						'Open task age (avg)',
						visible.map((d) => ({ x: d.date, y: d.openAvgAge })),
						'#F7931A'
					),
					line(
						'Oldest 10% age (p90)',
						visible.map((d) => ({ x: d.date, y: d.openP90Age })),
						'#E11D48'
					),
					line(
						'Age at completion (14d median)',
						visible.map((d) => ({ x: d.date, y: d.completedMedianAge })),
						'#3B82F6'
					)
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: { mode: 'index' as const, intersect: false },
				plugins: {
					legend: { position: 'top' as const, labels: LEGEND_LABELS },
					tooltip: {
						...TOOLTIP,
						callbacks: {
							label: (item: any) =>
								item.raw.y === null
									? undefined
									: `${item.dataset.label}: ${Math.round(item.raw.y)} days`
						}
					}
				},
				scales: {
					x: {
						type: 'time' as const,
						time: {
							unit: 'week' as const,
							tooltipFormat: 'YYYY-MM-DD',
							displayFormats: { day: 'MMM D', week: 'MMM D', month: 'MMM YYYY' }
						},
						min: dateRange.start,
						max: dateRange.end,
						grid: { color: 'rgba(30, 41, 59, 0.4)', lineWidth: 0.5 },
						ticks: { ...TICKS, maxRotation: 0 },
						border: { color: 'rgba(30, 41, 59, 0.6)' }
					},
					y: {
						beginAtZero: true,
						grid: GRID,
						ticks: TICKS,
						border: { display: false },
						title: { display: true, text: 'days', color: '#94A3B8', font: TICKS.font }
					}
				}
			}
		};
	}

	function buildFlowConfig() {
		const unitLabel = { day: 'day', week: 'week of', month: 'month' }[bucket];
		// One dataset per category and direction; created stacks up, completed down.
		const datasets = categories.flatMap((cat, i) => {
			const color = getSeriesColor(cat, colorMap, i);
			const base = {
				label: cat,
				backgroundColor: color.bg,
				borderColor: color.border,
				borderWidth: 1,
				borderRadius: 2
			};
			return [
				{ ...base, stack: 'created', data: flows.map((f) => f.created[cat] ?? 0) },
				{ ...base, stack: 'completed', data: flows.map((f) => -(f.completed[cat] ?? 0)) }
			];
		});
		return {
			type: 'bar' as const,
			data: { labels: flows.map((f) => f.label), datasets },
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: { mode: 'index' as const, intersect: false },
				plugins: {
					legend: {
						position: 'top' as const,
						labels: {
							...LEGEND_LABELS,
							// One entry per category — toggling it hides both directions
							filter: (item: any, data: any) =>
								data.datasets[item.datasetIndex]?.stack === 'created'
						},
						onClick: (_e: any, item: any, legend: any) => {
							const c = legend.chart;
							for (let i = 0; i < c.data.datasets.length; i++) {
								if (c.data.datasets[i].label === item.text) {
									c.setDatasetVisibility(i, !c.isDatasetVisible(i));
								}
							}
							c.update();
						}
					},
					tooltip: {
						...TOOLTIP,
						filter: (item: any) => item.raw !== 0,
						callbacks: {
							title: (items: any[]) => `${unitLabel} ${items[0]?.label ?? ''}`,
							label: (item: any) =>
								`${item.raw > 0 ? 'Created' : 'Completed'} · ${item.dataset.label}: ${Math.abs(item.raw)}`,
							footer: (items: any[]) => {
								const created = items.reduce((s, i) => s + Math.max(0, i.raw), 0);
								const completed = items.reduce((s, i) => s + Math.max(0, -i.raw), 0);
								return `Created: ${created} · Completed: ${completed}`;
							}
						}
					}
				},
				scales: {
					x: {
						stacked: true,
						grid: { display: false },
						ticks: { ...TICKS, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
						border: { color: 'rgba(30, 41, 59, 0.6)' }
					},
					y: {
						stacked: true,
						grid: GRID,
						ticks: { ...TICKS, precision: 0, callback: (v: number) => Math.abs(v) },
						border: { display: false }
					}
				}
			}
		};
	}

	function rebuildChart() {
		if (!ChartJS || !canvas) return;
		chart?.destroy();
		chart = new ChartJS(canvas, tab === 'age' ? buildAgeConfig() : buildFlowConfig());
	}

	onMount(async () => {
		const mod = await import('chart.js');
		await import('chartjs-adapter-dayjs-4');
		ChartJS = mod.Chart;
		ChartJS.register(...mod.registerables);
		rebuildChart();
	});

	$effect(() => {
		// Read all reactive inputs to subscribe to changes
		const _m = metrics;
		const _f = flows;
		const _c = categories;
		const _cm = colorMap;
		const _r = dateRange;
		const _t = tab;
		rebuildChart();
	});

	onDestroy(() => {
		chart?.destroy();
	});
</script>

<div class="flex flex-col h-full">
	<div class="flex items-center gap-3 mb-3">
		<div class="flex items-center gap-1 bg-black/30 rounded-control p-1">
			{#each TABS as t}
				<button
					onclick={() => (tab = t.value)}
					class="px-3 py-1.5 rounded-pill text-xs font-[var(--font-mono)] uppercase tracking-wider transition-all duration-150 {tab ===
					t.value
						? ''
						: 'preset-btn'}"
					style={tab === t.value
						? 'background: var(--color-bitcoin); color: black; font-weight: 500; box-shadow: 0 0 16px -4px var(--color-bitcoin-glow-strong);'
						: ''}
				>
					{t.label}
				</button>
			{/each}
		</div>
		{#if tab === 'flow'}
			<div class="flex items-center gap-1 bg-black/30 rounded-control p-1">
				{#each BUCKETS as b}
					<button
						onclick={() => (bucketOverride = b.value)}
						class="px-3 py-1.5 rounded-pill text-xs font-[var(--font-mono)] uppercase tracking-wider transition-all duration-150 {bucket ===
						b.value
							? ''
							: 'preset-btn'}"
						style={bucket === b.value
							? 'background: var(--color-bitcoin); color: black; font-weight: 500; box-shadow: 0 0 16px -4px var(--color-bitcoin-glow-strong);'
							: ''}
					>
						{b.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
	<div class="flex-1 min-h-0">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
