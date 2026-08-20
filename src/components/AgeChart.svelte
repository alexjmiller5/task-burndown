<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { DayMetrics } from '$lib/data/metrics.js';

	interface Props {
		metrics: DayMetrics[];
		dateRange: { start: string; end: string };
	}

	let { metrics, dateRange }: Props = $props();

	let canvas: HTMLCanvasElement;
	let chart: any = null;
	let ChartJS: any = null;

	const TICKS = { color: '#94A3B8', font: { family: 'JetBrains Mono', size: 10 } };

	function buildConfig() {
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
					legend: {
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
					},
					tooltip: {
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
						cornerRadius: 8,
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
						grid: { color: 'rgba(30, 41, 59, 0.3)', lineWidth: 0.5 },
						ticks: TICKS,
						border: { display: false },
						title: { display: true, text: 'days', color: '#94A3B8', font: TICKS.font }
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
		const mod = await import('chart.js');
		await import('chartjs-adapter-dayjs-4');
		ChartJS = mod.Chart;
		ChartJS.register(...mod.registerables);
		rebuildChart();
	});

	$effect(() => {
		// Read all reactive inputs to subscribe to changes
		const _m = metrics;
		const _r = dateRange;
		rebuildChart();
	});

	onDestroy(() => {
		chart?.destroy();
	});
</script>

<canvas bind:this={canvas}></canvas>
