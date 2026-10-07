// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Platform {
			env: Env & {
				NOTION_API_KEY?: string;
				LIFE_TASKS_CONFIG?: string;
				LIFE_HUB_URL?: string;
				LIFE_HUB_TOKEN?: string;
			};
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}
	}
}

export {};
