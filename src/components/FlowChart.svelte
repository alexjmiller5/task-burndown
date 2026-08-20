<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { FlowBucket, FlowRow } from '$lib/data/metrics.js';
	import { getSeriesColor } from '$lib/colors.js';
	import dayjs from 'dayjs';

	interface Props {
		flows: FlowRow[];
		bucket: FlowBucket;
		categories: string[];
		colorMap: Record<string, string>;
		dateRange: { start: string; end: string };
		hiddenByDefault?: string[];
	}

	let { flows, bucket, categories, colorMap, dateRange, hiddenByDefault = [] }: Props = $props();

	let canvas: HTMLCanvasElement;
	let chart: any = null;
	let ChartJS: any = null;
	let isMobile = $state(false);
	let mobileMql: MediaQueryList | null = null;
	function syncIsMobile(e: MediaQueryListEvent | MediaQueryList) {
		isMobile = 'matches' in e ? e.matches : false;
	}

	function formatTitle(dateish: string | number): string {
		if (bucket === 'month') return dayjs(`${dateish}-01`).format('MMM YYYY');
		if (bucket === 'week') return `Week of ${dayjs(dateish).format('MMM D')}`;
		return dayjs(dateish).format('MMM D, YYYY');
	}

	// Day/week share the Active view's continuous time axis; month labels each bar.
	function xAxis() {
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
						return dayjs(`${this.getLabelForValue(value)}-01`).format('MMM YYYY');
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
			min: dateRange.start,
			max: dateRange.end,
			offset: true
		};
	}

	function buildConfig() {
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
							color: '#94A3B8',
							font: { family: 'JetBrains Mono', size: isMobile ? 9 : 11 },
							boxWidth: isMobile ? 10 : 12,
							boxHeight: isMobile ? 10 : 12,
							padding: isMobile ? 8 : 16,
							useBorderRadius: true,
							borderRadius: 2,
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
						mode: 'index' as const,
						intersect: false,
						position: 'cursor' as const,
						caretSize: 6,
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
						cornerRadius: 8,
						filter: (item: any) => item.raw !== 0,
						callbacks: {
							title: (items: any[]) => (items[0] ? formatTitle(items[0].label) : ''),
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
					x: xAxis(),
					y: {
						stacked: true,
						grid: { color: 'rgba(30, 41, 59, 0.3)', lineWidth: 0.5 },
						ticks: {
							color: '#94A3B8',
							font: { family: 'JetBrains Mono', size: 10 },
							precision: 0,
							callback: (v: number) => Math.abs(v)
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
		chart = new ChartJS(canvas, buildConfig());
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

		// Register the cursor-following tooltip positioner (also used by TaskChart,
		// but this chart can mount first when the app loads in flow mode)
		(mod.Tooltip as any).positioners.cursor = function (
			_elements: any[],
			eventPosition: { x: number; y: number }
		) {
			return { x: eventPosition.x, y: eventPosition.y };
		};

		rebuildChart();
	});

	$effect(() => {
		// Read all reactive inputs to subscribe to changes
		const _f = flows;
		const _b = bucket;
		const _c = categories;
		const _cm = colorMap;
		const _h = hiddenByDefault;
		const _m = isMobile;
		rebuildChart();
	});

	onDestroy(() => {
		mobileMql?.removeEventListener('change', syncIsMobile);
		chart?.destroy();
	});
</script>

<canvas bind:this={canvas}></canvas>
