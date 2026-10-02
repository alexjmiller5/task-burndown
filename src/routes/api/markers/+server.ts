import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { parseMarkers } from '$lib/markers.js';

// The user's chart markers: one small JSON object in the app's own R2 bucket,
// replaced wholesale by the marker editor. CF Access restricts callers.
const MARKERS_KEY = 'markers.json';

export const GET: RequestHandler = async ({ platform }) => {
	const obj = await platform!.env.CACHE.get(MARKERS_KEY);
	return json(obj ? parseMarkers(await obj.json()) : []);
};

export const PUT: RequestHandler = async ({ request, platform }) => {
	let markers;
	try {
		markers = parseMarkers(await request.json());
	} catch (e) {
		return json({ error: (e as Error).message }, { status: 400 });
	}
	await platform!.env.CACHE.put(MARKERS_KEY, JSON.stringify(markers), {
		httpMetadata: { contentType: 'application/json' }
	});
	return json(markers);
};
