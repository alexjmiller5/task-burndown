<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { DayCount, GroupBy } from '$lib/types.js';
	import {
		bucketLabel,
		rollingAvgTotals,
		type CompletionRow,
		type FlowBucket
	} from '$lib/data/metrics.js';
	import { DONE_COLOR, getSeriesColor, hatch } from '$lib/colors.js';
	import { hiddenLegendLabels, recordLegendToggle, syncLegendMemory } from '$lib/legend.js';
	import { createMarkerPlugin, type ChartMarker } from '$lib/markers.js';
	import dayjs from 'dayjs';

	interface Props {
		dailyCounts: DayCount[];
		categories: string[];
		groupBy: GroupBy;
		dateRange: { start: string; end: string };
		tagColors: Record<string, string>;
		hiddenByDefault?: string[];
		bucket?: FlowBucket;
		/** Full (non-downsampled) daily series the 14d avg is computed from. */
		avgSource?: DayCount[];
		markers?: ChartMarker[];
		/** Per-bucket completion counts (backlog vs same-day) for the overlay + tooltip. */
		completions?: CompletionRow[];
		/** Draw the completion bars; the tooltip footer shows completions regardless. */
		showCompleted?: boolean;
	}

	let {
		dailyCounts,
		categories,
		groupBy,
		dateRange,
		tagColors,
		hiddenByDefault = [],
		bucket = 'day',
		avgSource = [],
		markers = [],
		completions = [],
		showCompleted = false
	}: Props = $props();

	// The 14d avg tracks what the legend shows: hidden categories drop out of
	// the sum. Recomputed on rebuild and on legend clicks; the marker plugin
	// reads the latest value for its headroom math.
	let averages: Record<string, number> = {};
	function visibleAvg(): Record<string, number> {
		return rollingAvgTotals(
			avgSource,
			14,
			categories.filter((c) => !hiddenLegendLabels.has(c))
		);
	}

	// Top of the tallest stack including its same-day cap, so the marker-label
	// headroom accounts for the cap poking above the open-task total.
	let capTop = 0;
	const markerPlugin = createMarkerPlugin(
		() => markers,
		() => {
			let dataMax = capTop;
			for (const d of dailyCounts) {
				if (d.date < dateRange.start || d.date > dateRange.end) continue;
				dataMax = Math.max(dataMax, (d.total as number) ?? 0, averages[d.date] ?? 0);
			}
			return dataMax;
		}
	);

	let canvas: HTMLCanvasElement;
	let chart: any = null;
	let ChartJS: any = null;
	let isMobile = $state(false);
	let mobileMql: MediaQueryList | null = null;
	function syncIsMobile(e: MediaQueryListEvent | MediaQueryList) {
		isMobile = 'matches' in e ? e.matches : false;
	}

	// Day/week keep the continuous time axis; month labels each bar (like Flow).
	function xAxis(range: { start: string; end: string }) {
		const common = {
			stacked: true,
			grid: { color: 'rgba(30, 41, 59, 0.4)', lineWidth: 0.5 },
			ticks: {
				color: '#94A3B8',
				font: { family: 'JetBrains Mono', size: 10 },
				maxRotation: 0
			},
			border: { color: 'rgba(30, 41, 59, 0.6)' }
		};
		if (bucket === 'month') {
			return {
				...common,
				type: 'category' as const,
				grid: { display: false },
				ticks: {
					...common.ticks,
					autoSkip: true,
					maxTicksLimit: isMobile ? 6 : 12,
					callback: function (this: any, value: number) {
						return dayjs(this.getLabelForValue(value)).format('MMM YYYY');
					}
				}
			};
		}
		return {
			...common,
			type: 'time' as const,
			time: {
				unit: 'week' as const,
				displayFormats: { day: 'MMM D', week: 'MMM D', month: 'MMM YYYY' }
			},
			min: range.start,
			max: range.end
		};
	}

	function buildConfig(counts: DayCount[], cats: string[], range: { start: string; end: string }) {
		// Filter to visible range so bars don't extend past the axis
		const visible = counts.filter((d) => d.date >= range.start && d.date <= range.end);
		// Completion rows aligned to the visible points (each point represents the
		// bucket its date falls in, so week/month views line up too).
		const compByLabel = new Map(completions.map((r) => [r.label, r]));
		const comp = visible.map((d) => compByLabel.get(bucketLabel(d.date, bucket)));
		// Tallest stack including the same-day cap, for the marker headroom math.
		capTop = showCompleted
			? Math.max(0, ...visible.map((d, i) => ((d.total as number) || 0) + (comp[i]?.sameDay ?? 0)))
			: 0;
		return {
			type: 'bar' as const,
			data: {
				labels: visible.map((d) => d.date),
				datasets: [
					// First dataset draws on top: the 2-week average line over the bars
					{
						type: 'line' as const,
						label: '14d avg',
						data: visible.map((d) => averages[d.date] ?? null),
						borderColor: '#FFD600',
						backgroundColor: '#FFD600',
						borderWidth: 2,
						pointRadius: 0,
						pointHitRadius: 8,
						tension: 0.3,
						spanGaps: true
					},
					...cats.map((cat, i) => {
						const color = getSeriesColor(cat, tagColors, i);
						return {
							label: cat,
							data: visible.map((d) => (d[cat] as number) || 0),
							backgroundColor: color.bg,
							borderColor: color.border,
							borderWidth: 1,
							borderRadius: 2,
							stack: 'stack0'
						};
					}),
					// Same-day churn cap: tasks created AND completed the same day are
					// invisible to the open count (they net zero), so they get a
					// full-width hatched segment stacked on top of the bar at true
					// 1:1 scale — the only place the chart can show they existed.
					...(showCompleted
						? [
								{
									label: 'Same-day',
									data: comp.map((c) => c?.sameDay ?? 0),
									backgroundColor: hatch(DONE_COLOR),
									borderColor: DONE_COLOR.border,
									borderWidth: 1,
									borderRadius: 2,
									stack: 'stack0',
									isCompletion: true
								}
							]
						: [])
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				animation: false,
				interaction: {
					mode: 'index' as const,
					intersect: false
				},
				plugins: {
					legend: {
						position: 'top' as const,
						labels: {
							color: '#94A3B8',
							font: { family: 'JetBrains Mono', size: isMobile ? 9 : 11 },
							boxWidth: isMobile ? 10 : 12,
							boxHeight: isMobile ? 10 : 12,
							padding: isMobile ? 8 : 16,
							useBorderRadius: true,
							borderRadius: 2,
							// The Done chip toggles the overlay; keep it out of the legend
							filter: (item: any, data: any) => !data.datasets[item.datasetIndex]?.isCompletion
						},
						// Default toggle + remember the choice, so it survives the
						// chart rebuild that any range/data change triggers.
						onClick: (_e: any, item: any, legend: any) => {
							const c = legend.chart;
							const i = item.datasetIndex;
							recordLegendToggle(c.data.datasets[i].label, c.isDatasetVisible(i));
							// Full rebuild: the avg line AND the completion-overlay bases
							// both depend on which categories are visible. Deferred a
							// frame so we don't destroy the chart inside its own handler.
							requestAnimationFrame(rebuildChart);
						}
					},
					tooltip: {
						mode: 'index' as const,
						intersect: false,
						position: 'cursor' as const,
						caretSize: 6,
						backgroundColor: 'rgba(15, 17, 21, 0.95)',
						borderColor: 'rgba(247, 147, 26, 0.3)',
						borderWidth: 1,
						titleColor: '#FFFFFF',
						bodyColor: '#94A3B8',
						titleFont: {
							family: 'Space Grotesk',
							size: 13,
							weight: '600' as const
						},
						bodyFont: { family: 'JetBrains Mono', size: 11 },
						footerColor: '#FFFFFF',
						footerFont: { family: 'JetBrains Mono', size: 12, weight: 'bold' as const },
						padding: 12,
						cornerRadius: 8,
						callbacks: {
							title: (items: any[]) => {
								if (!items[0]) return '';
								const d = bucket === 'month' ? dayjs(items[0].label) : dayjs(items[0].parsed.x);
								if (bucket === 'month') return d.format('MMM YYYY');
								if (bucket === 'week') return `Week ending ${d.format('MMM D')}`;
								return d.format('MMM D, YYYY');
							},
							label: (item: any) =>
								item.dataset.type === 'line'
									? `${item.dataset.label}: ${Math.round(item.raw)}`
									: `${item.dataset.label}: ${item.raw}`,
							footer: (items: any[]) => {
								const total = items.reduce(
									(sum: number, item: any) =>
										item.dataset.type === 'line' ? sum : sum + (item.raw || 0),
									0
								);
								const lines = [`Total: ${total}`];
								const c = items[0] ? comp[items[0].dataIndex] : undefined;
								if (c && (c.added > 0 || c.backlog + c.sameDay > 0)) {
									lines.push(`Added: ${c.added}`);
									lines.push(`Completed: ${c.backlog + c.sameDay} · ${c.sameDay} same-day`);
								}
								return lines;
							}
						},
						filter: (item: any) => item.raw > 0 && !item.dataset.isCompletion
					}
				},
				scales: {
					x: xAxis(range),
					y: {
						stacked: true,
						beginAtZero: true,
						grid: { color: 'rgba(30, 41, 59, 0.3)', lineWidth: 0.5 },
						ticks: {
							color: '#94A3B8',
							font: { family: 'JetBrains Mono', size: 10 }
						},
						border: { display: false }
					}
				}
			}
		};
	}

	function rebuildChart() {
		if (!ChartJS || !canvas) return;
		chart?.destroy();
		markerPlugin.reset();
		// Sync legend memory first (restores this group-by's persisted toggles)
		// so the avg line is built over the surviving categories.
		syncLegendMemory(groupBy, hiddenByDefault);
		averages = visibleAvg();
		chart = new ChartJS(canvas, {
			...buildConfig(dailyCounts, categories, dateRange),
			plugins: [markerPlugin]
		});
		// Restore remembered legend toggles so they survive the rebuild.
		if (hiddenLegendLabels.size > 0) {
			for (let i = 0; i < chart.data.datasets.length; i++) {
				if (hiddenLegendLabels.has(chart.data.datasets[i].label)) {
					chart.setDatasetVisibility(i, false);
				}
			}
			chart.update('none');
		}
	}

	onMount(async () => {
		if (typeof window !== 'undefined' && window.matchMedia) {
			mobileMql = window.matchMedia('(max-width: 639px)');
			isMobile = mobileMql.matches;
			mobileMql.addEventListener('change', syncIsMobile);
		}

		const mod = await import('chart.js');
		await import('chartjs-adapter-dayjs-4');
		ChartJS = mod.Chart;
		ChartJS.register(...mod.registerables);

		// Register custom tooltip positioner that follows the cursor
		(mod.Tooltip as any).positioners.cursor = function (
			_elements: any[],
			eventPosition: { x: number; y: number }
		) {
			return { x: eventPosition.x, y: eventPosition.y };
		};

		rebuildChart();
	});

	$effect(() => {
		// Read all reactive props to subscribe to changes
		const _d = dailyCounts;
		const _c = categories;
		const _r = dateRange;
		const _tc = tagColors;
		const _h = hiddenByDefault;
		const _b = bucket;
		const _a = avgSource;
		const _mk = markers;
		const _m = isMobile;
		const _cp = completions;
		const _sc = showCompleted;
		// Rebuild on any change
		rebuildChart();
	});

	onDestroy(() => {
		mobileMql?.removeEventListener('change', syncIsMobile);
		chart?.destroy();
	});
</script>

<canvas bind:this={canvas}></canvas>
