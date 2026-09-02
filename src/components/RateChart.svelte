<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { CompletionRow, FlowBucket } from '$lib/data/metrics.js';
	import dayjs from 'dayjs';

	interface Props {
		completions: CompletionRow[];
		bucket: FlowBucket;
		dateRange: { start: string; end: string };
	}

	let { completions, bucket, dateRange }: Props = $props();

	// The burndown's rate of change: added (backlog grew) up in the marker
	// red, completed (backlog shrank) down in the marker green. Same-day
	// churn lives on the main chart's cap, not here — these two series ARE
	// the day-over-day delta of the open count.
	const ADDED = { bg: 'rgba(248, 113, 113, 0.6)', border: 'rgba(248, 113, 113, 1)' };
	const COMPLETED = { bg: 'rgba(74, 222, 128, 0.6)', border: 'rgba(74, 222, 128, 1)' };

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
		return {
			type: 'bar' as const,
			data: {
				labels: completions.map((r) => r.label),
				datasets: [
					{
						label: 'Added',
						data: completions.map((r) => r.added),
						backgroundColor: ADDED.bg,
						borderColor: ADDED.border,
						borderWidth: 1,
						borderRadius: 2
					},
					{
						label: 'Completed',
						data: completions.map((r) => -r.backlog),
						backgroundColor: COMPLETED.bg,
						borderColor: COMPLETED.border,
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
						titleFont: { family: 'Space Grotesk', size: 13, weight: '600' as const },
						bodyFont: { family: 'JetBrains Mono', size: 11 },
						footerColor: '#FFFFFF',
						footerFont: { family: 'JetBrains Mono', size: 12, weight: 'bold' as const },
						padding: 12,
						cornerRadius: 8,
						filter: (item: any) => item.raw !== 0,
						callbacks: {
							title: (items: any[]) => (items[0] ? formatTitle(items[0].label) : ''),
							label: (item: any) => `${item.dataset.label}: ${Math.abs(item.raw)}`,
							footer: (items: any[]) => {
								if (!items[0]) return '';
								const r = completions[items[0].dataIndex];
								const net = r.added - r.backlog;
								return `Net: ${net > 0 ? '+' : ''}${net}`;
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
		// but this chart can mount first when the app loads in rate mode)
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
		const _c = completions;
		const _b = bucket;
		const _m = isMobile;
		rebuildChart();
	});

	onDestroy(() => {
		mobileMql?.removeEventListener('change', syncIsMobile);
		chart?.destroy();
	});
</script>

<canvas bind:this={canvas}></canvas>
