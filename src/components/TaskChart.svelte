<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { DayCount } from '$lib/types.js';

	interface Props {
		dailyCounts: DayCount[];
		categories: string[];
		dateRange: { start: string; end: string };
		tagColors: Record<string, string>;
		hiddenByDefault?: string[];
	}

	let { dailyCounts, categories, dateRange, tagColors, hiddenByDefault = [] }: Props = $props();

	let canvas: HTMLCanvasElement;
	let chart: any = null;
	let ChartJS: any = null;
	let isMobile = $state(false);
	let mobileMql: MediaQueryList | null = null;
	function syncIsMobile(e: MediaQueryListEvent | MediaQueryList) {
		isMobile = 'matches' in e ? e.matches : false;
	}

	// Map Notion color names to chart-friendly RGBA values
	const NOTION_COLOR_MAP: Record<string, { bg: string; border: string }> = {
		default: { bg: 'rgba(148, 163, 184, 0.55)', border: 'rgba(148, 163, 184, 1)' },
		gray: { bg: 'rgba(148, 163, 184, 0.55)', border: 'rgba(148, 163, 184, 1)' },
		brown: { bg: 'rgba(180, 130, 80, 0.6)', border: 'rgba(180, 130, 80, 1)' },
		orange: { bg: 'rgba(247, 147, 26, 0.7)', border: 'rgba(247, 147, 26, 1)' },
		yellow: { bg: 'rgba(234, 179, 8, 0.6)', border: 'rgba(234, 179, 8, 1)' },
		green: { bg: 'rgba(34, 197, 94, 0.6)', border: 'rgba(34, 197, 94, 1)' },
		blue: { bg: 'rgba(59, 130, 246, 0.6)', border: 'rgba(59, 130, 246, 1)' },
		purple: { bg: 'rgba(168, 85, 247, 0.6)', border: 'rgba(168, 85, 247, 1)' },
		pink: { bg: 'rgba(236, 72, 153, 0.6)', border: 'rgba(236, 72, 153, 1)' },
		red: { bg: 'rgba(239, 68, 68, 0.6)', border: 'rgba(239, 68, 68, 1)' }
	};

	// Fallback palette for tags without Notion colors
	const FALLBACK_COLORS = [
		{ bg: 'rgba(14, 165, 233, 0.55)', border: 'rgba(14, 165, 233, 1)' },
		{ bg: 'rgba(20, 184, 166, 0.55)', border: 'rgba(20, 184, 166, 1)' },
		{ bg: 'rgba(132, 204, 22, 0.55)', border: 'rgba(132, 204, 22, 1)' },
		{ bg: 'rgba(249, 115, 22, 0.55)', border: 'rgba(249, 115, 22, 1)' },
		{ bg: 'rgba(99, 102, 241, 0.55)', border: 'rgba(99, 102, 241, 1)' }
	];

	function getTagColor(tag: string, index: number) {
		const notionColor = tagColors[tag];
		if (notionColor?.startsWith('#')) {
			const r = parseInt(notionColor.slice(1, 3), 16);
			const g = parseInt(notionColor.slice(3, 5), 16);
			const b = parseInt(notionColor.slice(5, 7), 16);
			return { bg: `rgba(${r}, ${g}, ${b}, 0.55)`, border: notionColor };
		}
		if (notionColor && NOTION_COLOR_MAP[notionColor]) {
			return NOTION_COLOR_MAP[notionColor];
		}
		return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
	}

	function buildConfig(counts: DayCount[], cats: string[], range: { start: string; end: string }) {
		// Filter to visible range so bars don't extend past the axis
		const visible = counts.filter((d) => d.date >= range.start && d.date <= range.end);
		return {
			type: 'bar' as const,
			data: {
				labels: visible.map((d) => d.date),
				datasets: cats.map((cat, i) => {
					const color = getTagColor(cat, i);
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
							footer: (items: any[]) => {
								const total = items.reduce((sum: number, item: any) => sum + (item.raw || 0), 0);
								return `Total: ${total}`;
							}
						},
						filter: (item: any) => item.raw > 0
					}
				},
				scales: {
					x: {
						type: 'time' as const,
						time: {
							unit: 'week' as const,
							tooltipFormat: 'YYYY-MM-DD',
							displayFormats: {
								day: 'MMM D',
								week: 'MMM D',
								month: 'MMM YYYY'
							}
						},
						min: range.start,
						max: range.end,
						stacked: true,
						grid: { color: 'rgba(30, 41, 59, 0.4)', lineWidth: 0.5 },
						ticks: {
							color: '#94A3B8',
							font: { family: 'JetBrains Mono', size: 10 },
							maxRotation: 0
						},
						border: { color: 'rgba(30, 41, 59, 0.6)' }
					},
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
