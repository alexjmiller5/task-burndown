// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Platform {
			env: Env & {
				NOTION_API_KEY?: string;
				SOMA_TASKS_CONFIG?: string;
				SOMA_HUB_URL?: string;
				SOMA_HUB_TOKEN?: string;
				/** Service binding to the Soma hub Worker; absent in tests. The dev server declares it with no hub behind it, so dev reads use the network. */
				SOMA_HUB?: { fetch: typeof fetch };
			};
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}
	}
}

export {};
