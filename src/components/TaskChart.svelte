<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { DayCount, GroupBy } from '$lib/types.js';
	import {
		bucketLabel,
		rollingAvgTotals,
		type CompletionRow,
		type FlowBucket
	} from '$lib/data/metrics.js';
	import { getSeriesColor } from '$lib/colors.js';
	import { hiddenLegendLabels, recordLegendToggle, syncLegendMemory } from '$lib/legend.js';
	import {
		assignLane,
		laneStripHeight,
		MARKER_LANE_HEIGHT,
		type ChartMarker,
		type PlacedLabel
	} from '$lib/markers.js';
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

	// Muted single tone for the completion overlay — category detail stays in
	// the stacked area; these bars only answer "how much went out, how much of
	// it was same-day churn".
	const DONE_COLOR = { bg: 'rgba(203, 213, 225, 0.35)', border: 'rgba(203, 213, 225, 0.9)' };

	// Diagonal-stripe tile marking the same-day portion of the overlay bars.
	function hatch(color: { bg: string; border: string }): CanvasPattern | string {
		const tile = document.createElement('canvas');
		tile.width = tile.height = 6;
		const ctx = tile.getContext('2d');
		if (!ctx) return color.bg;
		ctx.strokeStyle = color.border;
		ctx.lineWidth = 1.2;
		ctx.beginPath();
		ctx.moveTo(-1.5, 1.5);
		ctx.lineTo(1.5, -1.5);
		ctx.moveTo(-1.5, 7.5);
		ctx.lineTo(7.5, -1.5);
		ctx.moveTo(4.5, 7.5);
		ctx.lineTo(7.5, 4.5);
		ctx.stroke();
		return ctx.createPattern(tile, 'repeat') ?? color.bg;
	}

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

	// Vertical event lines for the manual markers (time-axis buckets only).
	// Labels sit inside the plot, in headroom opened up above the tallest bar by
	// raising the y-axis max — so they read against the chart without covering data.
	let laneHeadroom = 0;
	// Top of the tallest completion overlay bar (y units), so the marker-label
	// headroom accounts for the bars poking above the stacks.
	let chimneyTop = 0;
	// Re-fitting the headroom costs a relayout, so cap it per chart instance —
	// a loop here would hang the page, and it settles in a pass or two.
	let laneFits = 0;
	const markerPlugin = {
		id: 'eventMarkers',
		afterDatasetsDraw(c: any) {
			const x = c.scales.x;
			if (!x || x.type !== 'time') return;
			const { ctx, chartArea } = c;
			const px = (d: string) => x.getPixelForValue(new Date(`${d}T12:00:00`).getTime());
			const FONT = '10px JetBrains Mono';
			const GAP = 10;
			const TOP = chartArea.top + 4;

			// Backlog grew = bad = red; backlog shrank = good = green (the same green
			// AI Completed already uses for "done"). Stagnation bands stay neutral.
			// Light-400 shades: the age ramp's 1-3m band is a dark crimson (#E11D48),
			// so a mid red rule vanished into it — these separate on luminance too.
			const UP = '248, 113, 113';
			const DOWN = '74, 222, 128';
			const FLAT = '148, 163, 184';

			ctx.font = FONT;
			const placed: PlacedLabel[] = [];
			const ordered = [...markers].sort((a, b) => (a.date < b.date ? -1 : 1));

			// Pass 1: lay the labels out, so pass 2 knows how deep the block goes and
			// can start every rule below all of them rather than through one.
			const items: {
				atX: number;
				label: string;
				rgb: string;
				dashed: boolean;
				lane: number;
				left: number;
				w: number;
			}[] = [];
			for (const m of ordered) {
				const isFlat = m.direction === 'flat';
				const atX = isFlat ? Math.max(px(m.date), chartArea.left) : px(m.date);
				if (isFlat) {
					const b = Math.min(px(m.end ?? m.date), chartArea.right);
					if (b <= chartArea.left || atX >= chartArea.right) continue;
					ctx.save();
					ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
					ctx.fillRect(atX, chartArea.top, b - atX, chartArea.bottom - chartArea.top);
					ctx.restore();
				} else if (atX < chartArea.left || atX > chartArea.right) {
					continue;
				}
				const w = ctx.measureText(m.label).width;
				const left = Math.max(chartArea.left, Math.min(atX - w / 2, chartArea.right - w));
				const lane = assignLane(placed, left - GAP, left + w + GAP);
				placed.push({ lane, left: left - GAP, right: left + w + GAP });
				items.push({
					atX,
					label: m.label,
					rgb: isFlat ? FLAT : m.direction === 'up' ? UP : DOWN,
					dashed: !isFlat,
					lane,
					left,
					w
				});
			}

			const needed = laneStripHeight(placed);
			const laneY = (lane: number) => TOP + lane * MARKER_LANE_HEIGHT;

			// Pass 2: each rule runs from its own label down to the axis, broken
			// around any lower label it would otherwise strike through.
			for (const it of items) {
				const gaps = items
					.filter((o) => o.lane > it.lane && it.atX >= o.left - 2 && it.atX <= o.left + o.w + 2)
					.map((o) => [laneY(o.lane) - 2, laneY(o.lane) + MARKER_LANE_HEIGHT - 1])
					.sort((a, b) => a[0] - b[0]);

				ctx.save();
				ctx.strokeStyle = `rgba(${it.rgb}, 0.65)`;
				ctx.lineWidth = 1;
				if (it.dashed) ctx.setLineDash([4, 4]);
				ctx.beginPath();
				let y = laneY(it.lane) + MARKER_LANE_HEIGHT - 2;
				for (const [gapStart, gapEnd] of gaps) {
					if (gapEnd <= y) continue;
					if (gapStart > y) {
						ctx.moveTo(it.atX, y);
						ctx.lineTo(it.atX, gapStart);
					}
					y = Math.max(y, gapEnd);
				}
				ctx.moveTo(it.atX, y);
				ctx.lineTo(it.atX, chartArea.bottom);
				ctx.stroke();
				ctx.restore();
			}

			// Labels last, so no rule can be drawn over their text.
			for (const it of items) {
				ctx.save();
				ctx.fillStyle = `rgb(${it.rgb})`;
				ctx.font = FONT;
				ctx.textBaseline = 'top';
				ctx.fillText(it.label, it.left, laneY(it.lane));
				ctx.restore();
			}

			// Open headroom above the tallest bar by raising the axis max, so the
			// labels sit on empty chart rather than on the data.
			const want = needed + 10;
			const H = chartArea.bottom - chartArea.top;
			let dataMax = chimneyTop;
			for (const d of dailyCounts) {
				if (d.date < dateRange.start || d.date > dateRange.end) continue;
				dataMax = Math.max(dataMax, (d.total as number) ?? 0, averages[d.date] ?? 0);
			}
			if (dataMax > 0 && H > want + 20) {
				// Round up to a clean tick, else the axis tops out on something like
				// 843 and crowds the tick below it. Also keeps the refit stable.
				const raw = (dataMax * H) / (H - want);
				const step = raw >= 200 ? 100 : raw >= 50 ? 20 : 10;
				const target = Math.ceil(raw / step) * step;
				if (Math.abs(target - laneHeadroom) > 1 && laneFits < 3) {
					laneHeadroom = target;
					laneFits++;
					c.options.scales.y.max = target;
					requestAnimationFrame(() => c.update('none'));
				}
			}
		}
	};

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
		// The overlay bars sit on top of each day's stack (floating [base, top]
		// segments in y units), scaled so the tallest fills ~a quarter of the
		// plot. Base = the *visible* categories' total, so legend toggles don't
		// leave the bars hovering; a legend click triggers a rebuild (below).
		const compMax = Math.max(1, ...comp.map((c) => (c ? c.backlog + c.sameDay : 0)));
		const visCats = cats.filter((c) => !hiddenLegendLabels.has(c));
		const visTotal = visible.map((d) => visCats.reduce((s, c) => s + ((d[c] as number) || 0), 0));
		const dataMax = Math.max(1, ...visTotal);
		const yPerComp = (dataMax * 0.25) / compMax;
		chimneyTop = 0;
		const floatSeg = (i: number, from: number, len: number): [number, number] => {
			const base = visTotal[i] + from * yPerComp;
			const top = base + len * yPerComp;
			chimneyTop = Math.max(chimneyTop, top);
			return [base, top];
		};
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
					// Completion overlay (drawn over the category bars, under the avg
					// line): solid = backlog completions, hatched = same-day churn.
					...(showCompleted
						? [
								{
									label: 'Completed',
									data: comp.map((c, i) => floatSeg(i, 0, c?.backlog ?? 0)),
									backgroundColor: DONE_COLOR.bg,
									borderColor: DONE_COLOR.border,
									borderWidth: 1,
									borderRadius: 2,
									grouped: false,
									barPercentage: 0.45,
									isCompletion: true
								},
								{
									label: 'Same-day',
									data: comp.map((c, i) => floatSeg(i, c?.backlog ?? 0, c?.sameDay ?? 0)),
									backgroundColor: hatch(DONE_COLOR),
									borderColor: DONE_COLOR.border,
									borderWidth: 1,
									borderRadius: 2,
									grouped: false,
									barPercentage: 0.45,
									isCompletion: true
								}
							]
						: []),
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
					})
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
					},
					// Hidden axis for the completion overlay, scaled so its tallest
					// bar sits at ~1/4 of the plot height.
					y2: {
						display: false,
						beginAtZero: true,
						stacked: true,
						position: 'right' as const,
						max: compMax * 4
					}
				}
			}
		};
	}

	function rebuildChart() {
		if (!ChartJS || !canvas) return;
		chart?.destroy();
		laneHeadroom = 0;
		laneFits = 0;
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
