<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { DayCount } from '$lib/types.js';
	import type { FlowBucket } from '$lib/data/metrics.js';
	import { getSeriesColor } from '$lib/colors.js';
	import dayjs from 'dayjs';

	interface Props {
		dailyCounts: DayCount[];
		categories: string[];
		dateRange: { start: string; end: string };
		tagColors: Record<string, string>;
		hiddenByDefault?: string[];
		bucket?: FlowBucket;
	}

	let {
		dailyCounts,
		categories,
		dateRange,
		tagColors,
		hiddenByDefault = [],
		bucket = 'day'
	}: Props = $props();

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
		return {
			type: 'bar' as const,
			data: {
				labels: visible.map((d) => d.date),
				datasets: cats.map((cat, i) => {
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
				})
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
							borderRadius: 2
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
							footer: (items: any[]) => {
								const total = items.reduce((sum: number, item: any) => sum + (item.raw || 0), 0);
								return `Total: ${total}`;
							}
						},
						filter: (item: any) => item.raw > 0
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
		chart = new ChartJS(canvas, buildConfig(dailyCounts, categories, dateRange));
		// Hide datasets that should be off by default (e.g. "(No Project)")
		if (hiddenByDefault.length > 0) {
			for (let i = 0; i < chart.data.datasets.length; i++) {
				if (hiddenByDefault.includes(chart.data.datasets[i].label)) {
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
		const _m = isMobile;
		// Rebuild on any change
		rebuildChart();
	});

	onDestroy(() => {
		mobileMql?.removeEventListener('change', syncIsMobile);
		chart?.destroy();
	});
</script>

<canvas bind:this={canvas}></canvas>
