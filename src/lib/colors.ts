// Series color resolution for the bar charts.

export interface SeriesColor {
	bg: string;
	border: string;
}

// The ten palette names Soma's catalog options (and Notion) use, as Iris shows
// them, stepped as solid fills for the dark chart surface (#0f1115). All 45
// pairs stay apart in the dataviz validator: OKLab dE >= 15.5 in normal vision,
// >= 8.1 under protan/deutan, and every fill clears 3:1 against the surface.
const solid = (hex: string): SeriesColor => ({ bg: hex, border: hex });
export const NOTION_COLOR_MAP: Record<string, SeriesColor> = {
	default: solid('#58616c'),
	gray: solid('#8f9397'),
	brown: solid('#a3661c'),
	orange: solid('#f2932e'),
	yellow: solid('#f3d744'),
	green: solid('#55c889'),
	blue: solid('#4f85f5'),
	purple: solid('#8d4ac9'),
	pink: solid('#fe8acf'),
	red: solid('#f44f63')
};

// Fallback palette for series without Notion colors
export const FALLBACK_COLORS: SeriesColor[] = [
	{ bg: 'rgba(14, 165, 233, 0.55)', border: 'rgba(14, 165, 233, 1)' },
	{ bg: 'rgba(20, 184, 166, 0.55)', border: 'rgba(20, 184, 166, 1)' },
	{ bg: 'rgba(132, 204, 22, 0.55)', border: 'rgba(132, 204, 22, 1)' },
	{ bg: 'rgba(249, 115, 22, 0.55)', border: 'rgba(249, 115, 22, 1)' },
	{ bg: 'rgba(99, 102, 241, 0.55)', border: 'rgba(99, 102, 241, 1)' }
];

// Muted tone for same-day churn — deliberately outside every group-by
// palette so it reads as "not part of the open backlog".
export const DONE_COLOR: SeriesColor = {
	bg: 'rgba(203, 213, 225, 0.35)',
	border: 'rgba(203, 213, 225, 0.9)'
};

/** Diagonal-stripe tile marking same-day segments (client-only: needs a canvas). */
export function hatch(color: SeriesColor): CanvasPattern | string {
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

/** Resolve a series color: Notion color name, `#hex` (age-band ramp), or fallback by index. */
export function getSeriesColor(
	name: string,
	colorMap: Record<string, string>,
	index: number
): SeriesColor {
	const value = colorMap[name];
	if (value?.startsWith('#')) {
		const r = parseInt(value.slice(1, 3), 16);
		const g = parseInt(value.slice(3, 5), 16);
		const b = parseInt(value.slice(5, 7), 16);
		return { bg: `rgba(${r}, ${g}, ${b}, 0.55)`, border: value };
	}
	if (value && NOTION_COLOR_MAP[value]) {
		return NOTION_COLOR_MAP[value];
	}
	return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}
