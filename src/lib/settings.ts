// Settings shared by every device: one `settings.json` object in the app's R2
// bucket, served by /api/settings. Device-local choices stay in preferences.ts.
export interface Settings {
	/** Minutes after midnight a new day begins (0 = midnight); earlier times count as the day before. */
	dayStartMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = { dayStartMinutes: 0 };

/** Validate stored/submitted settings; throws on a bad value. */
export function parseSettings(input: unknown): Settings {
	const dayStartMinutes = (input as Record<string, unknown> | null)?.dayStartMinutes;
	if (
		typeof dayStartMinutes !== 'number' ||
		!Number.isInteger(dayStartMinutes) ||
		dayStartMinutes < 0 ||
		dayStartMinutes > 1439
	)
		throw new Error('dayStartMinutes must be a whole number from 0 to 1439');
	return { dayStartMinutes };
}
