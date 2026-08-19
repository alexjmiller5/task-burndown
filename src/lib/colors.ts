// Series color resolution shared by TaskChart and MetricsChart.

export interface SeriesColor {
	bg: string;
	border: string;
}

// Map Notion color names to chart-friendly RGBA values
export const NOTION_COLOR_MAP: Record<string, SeriesColor> = {
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

// Fallback palette for series without Notion colors
export const FALLBACK_COLORS: SeriesColor[] = [
	{ bg: 'rgba(14, 165, 233, 0.55)', border: 'rgba(14, 165, 233, 1)' },
	{ bg: 'rgba(20, 184, 166, 0.55)', border: 'rgba(20, 184, 166, 1)' },
	{ bg: 'rgba(132, 204, 22, 0.55)', border: 'rgba(132, 204, 22, 1)' },
	{ bg: 'rgba(249, 115, 22, 0.55)', border: 'rgba(249, 115, 22, 1)' },
	{ bg: 'rgba(99, 102, 241, 0.55)', border: 'rgba(99, 102, 241, 1)' }
];

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
