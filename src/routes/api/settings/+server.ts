import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { DEFAULT_SETTINGS, parseSettings } from '$lib/settings.js';

// Settings every device shares: one small JSON object in the app's own R2
// bucket, replaced wholesale. CF Access restricts callers.
const SETTINGS_KEY = 'settings.json';

export const GET: RequestHandler = async ({ platform }) => {
	const obj = await platform!.env.CACHE.get(SETTINGS_KEY);
	return json(obj ? parseSettings(await obj.json()) : DEFAULT_SETTINGS);
};

export const PUT: RequestHandler = async ({ request, platform }) => {
	let settings;
	try {
		settings = parseSettings(await request.json());
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 400 });
	}
	await platform!.env.CACHE.put(SETTINGS_KEY, JSON.stringify(settings), {
		httpMetadata: { contentType: 'application/json' }
	});
	return json(settings);
};
