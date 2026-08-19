<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { DayMetrics, FlowRow, FlowBucket } from '$lib/data/metrics.js';

	interface Props {
		metrics: DayMetrics[];
		flows: FlowRow[];
		flowBucket: FlowBucket;
		dateRange: { start: string; end: string };
	}

	let { metrics, flows, flowBucket, dateRange }: Props = $props();

	type Tab = 'age' | 'pushbacks' | 'flow';
	const TABS: { value: Tab; label: string }[] = [
		{ value: 'age', label: 'Age' },
		{ value: 'pushbacks', label: 'Push-backs' },
		{ value: 'flow', label: 'Flow' }
	];
	const TAB_VALUES = ['age', 'pushbacks', 'flow'] as const;
	function initialTab(): Tab {
		if (typeof location !== 'undefined') {
			const h = location.hash.slice(1) as Tab;
			if (TAB_VALUES.includes(h)) return h;
		}
		return 'age';
	}
	let tab: Tab = $state(initialTab());

	let canvas: HTMLCanvasElement;
	let chart: any = null;
	let ChartJS: any = null;

	const GRID = { color: 'rgba(30, 41, 59, 0.3)', lineWidth: 0.5 };
	const TICKS = { color: '#94A3B8', font: { family: 'JetBrains Mono', size: 10 } };
	const LEGEND = {
		position: 'top' as const,
		labels: {
			color: '#94A3B8',
			font: { family: 'JetBrains Mono', size: 11 },
			boxWidth: 12,
			boxHeight: 12,
			padding: 16,
			useBorderRadius: true,
			borderRadius: 2
		}
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
		padding: 12,
		cornerRadius: 8
	};

	function timeXAxis(range: { start: string; end: string }) {
		return {
			type: 'time' as const,
			time: {
				unit: 'week' as const,
				tooltipFormat: 'YYYY-MM-DD',
				displayFormats: { day: 'MMM D', week: 'MMM D', month: 'MMM YYYY' }
			},
			min: range.start,
			max: range.end,
			grid: { color: 'rgba(30, 41, 59, 0.4)', lineWidth: 0.5 },
			ticks: { ...TICKS, maxRotation: 0 },
			border: { color: 'rgba(30, 41, 59, 0.6)' }
		};
	}

	function lineDataset(label: string, data: { x: string; y: number | null }[], hex: string) {
		return {
			label,
			data,
			borderColor: hex,
			backgroundColor: hex,
			borderWidth: 2,
			pointRadius: 0,
			pointHitRadius: 8,
			spanGaps: false,
			tension: 0.2
		};
	}

	function buildAgeConfig() {
		const visible = metrics.filter((d) => d.date >= dateRange.start && d.date <= dateRange.end);
		return {
			type: 'line' as const,
			data: {
				datasets: [
					lineDataset(
						'Open task age (median)',
						visible.map((d) => ({ x: d.date, y: d.openMedianAge })),
						'#F7931A'
					),
					lineDataset(
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
					legend: LEGEND,
					tooltip: {
						...TOOLTIP,
						callbacks: {
							label: (item: any) =>
								item.raw.y === null ? undefined : `${item.dataset.label}: ${item.raw.y} days`
						}
					}
				},
				scales: {
					x: timeXAxis(dateRange),
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

	function buildPushbackConfig() {
		const visible = metrics.filter((d) => d.date >= dateRange.start && d.date <= dateRange.end);
		return {
			type: 'line' as const,
			data: {
				datasets: [
					{
						...lineDataset(
							'Push-backs (rolling 7 days)',
							visible.map((d) => ({ x: d.date, y: d.pushbacks })),
							'#E11D48'
						),
						fill: true,
						backgroundColor: 'rgba(225, 29, 72, 0.15)'
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: { mode: 'index' as const, intersect: false },
				plugins: { legend: LEGEND, tooltip: TOOLTIP },
				scales: {
					x: timeXAxis(dateRange),
					y: {
						beginAtZero: true,
						grid: GRID,
						ticks: { ...TICKS, precision: 0 },
						border: { display: false }
					}
				}
			}
		};
	}

	function buildFlowConfig() {
		const unitLabel = { day: 'day', week: 'week of', month: 'month' }[flowBucket];
		return {
			type: 'bar' as const,
			data: {
				labels: flows.map((f) => f.label),
				datasets: [
					{
						label: 'Created',
						data: flows.map((f) => f.created),
						backgroundColor: 'rgba(59, 130, 246, 0.55)',
						borderColor: 'rgba(59, 130, 246, 1)',
						borderWidth: 1,
						borderRadius: 2
					},
					{
						label: 'Completed',
						data: flows.map((f) => -f.completed),
						backgroundColor: 'rgba(34, 197, 94, 0.55)',
						borderColor: 'rgba(34, 197, 94, 1)',
						borderWidth: 1,
						borderRadius: 2
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: { mode: 'index' as const, intersect: false },
				plugins: {
					legend: LEGEND,
					tooltip: {
						...TOOLTIP,
						callbacks: {
							title: (items: any[]) => `${unitLabel} ${items[0]?.label ?? ''}`,
							label: (item: any) => `${item.dataset.label}: ${Math.abs(item.raw)}`
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
		const config =
			tab === 'age'
				? buildAgeConfig()
				: tab === 'pushbacks'
					? buildPushbackConfig()
					: buildFlowConfig();
		chart = new ChartJS(canvas, config);
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
		const _b = flowBucket;
		const _r = dateRange;
		const _t = tab;
		rebuildChart();
	});

	onDestroy(() => {
		chart?.destroy();
	});
</script>

<div class="flex flex-col h-full">
	<div class="flex items-center gap-1 bg-black/30 rounded-control p-1 self-start mb-3">
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
	<div class="flex-1 min-h-0">
		<canvas bind:this={canvas}></canvas>
	</div>
</div>
