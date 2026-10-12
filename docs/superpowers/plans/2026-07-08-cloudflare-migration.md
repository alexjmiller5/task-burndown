# Cloudflare Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the task burndown dashboard from Deno/adapter-node (+ dead OCI deploy stack) to Bun + SvelteKit on Cloudflare Workers with the Notion cache as parsed tasks in R2, Cloudflare Access in front, installable as an iOS homescreen PWA.

**Architecture:** R2 stores one JSON object of **parsed, unfiltered tasks** (~1.1 MB — raw Notion pages are 16.9 MB and blow the free tier's 10 ms CPU cap). Page load streams that object to the client (~0 CPU); incremental refresh runs on the Worker (~6–8 ms); full refresh is a client-driven chunked loop (3 Notion API pages per Worker request) ending in a streamed `PUT /api/cache`. Spec: `docs/superpowers/specs/2026-07-08-cloudflare-migration-design.md` (v2).

**Tech Stack:** Bun, SvelteKit (Svelte 5 runes), `@sveltejs/adapter-cloudflare`, wrangler v4, R2, vitest, Tailwind v4, Chart.js.

## Global Constraints

- **Bun, never npm** (`bun install`, `bun run`, `bunx`).
- Template source of truth: `~/Desktop/coding/templates/cf-site/` — copy files verbatim unless a task says to modify.
- Worker name `task-burndown`; R2 bucket `task-burndown-cache`; binding `CACHE`; object key `task-cache.json`.
- Secrets: only `.env.tpl` (op:// refs) is committed; never plaintext secrets on disk.
- `src/lib/data/` stays pure (no Deno/Node/DOM APIs). `src/components/` untouched.
- Tests: vitest, colocated `*.test.ts`, pure modules only — no Svelte component tests.
- All commits: `git commit` with the trailer lines used in this repo's recent history (Co-Authored-By Claude).
- Working directory: `/Users/alexmiller/Desktop/coding/active-projects/notion-task-burndown-chart`.

## File Structure (end state)

```
wrangler.jsonc                 # IaC: worker + assets + R2 binding
package.json / bun.lock        # template scripts + chart deps
vite.config.ts                 # template: adapter-cloudflare + vitest projects
tsconfig.json, prettier.config.js, .npmrc, worker-configuration.d.ts  # template
justfile                       # template verbs + `setup` recipe
.env.tpl                       # NOTION_API_KEY op:// ref
scripts/sync-secrets.sh        # from template
scripts/seed-cache.ts          # raw-pages file -> parsed TaskCache -> R2
scripts/generate-icons.ts      # one-off PNG icon generation
.github/workflows/deploy.yml   # template, vault refs filled in
src/app.d.ts                   # Platform typed with Env + NOTION_API_KEY
src/app.html                   # + manifest/apple-touch-icon/theme-color links
src/lib/types.ts               # Task.lastEditedTime, TaskCache
src/lib/data/parser.ts         # no longer filters; emits lastEditedTime
src/lib/data/merge.ts          # NEW: mergeParsedData, getIncrementalSince
src/lib/server/cache.ts        # R2 get/put
src/lib/server/secrets.ts      # env lookup only
src/lib/server/notion.ts       # + fetchPageChunk; page-level merge fns removed
src/lib/server/refresh-policy.ts  # unchanged
src/routes/api/tasks/+server.ts        # NEW: GET streams R2 object
src/routes/api/refresh/+server.ts      # incremental only, returns needsFull
src/routes/api/refresh-chunk/+server.ts # NEW: 3-page chunk
src/routes/api/cache/+server.ts        # NEW: PUT streams body to R2
src/routes/+page.svelte        # loads via /api/tasks, chunked fullSync
static/manifest.webmanifest, icon-192.png, icon-512.png, apple-touch-icon.png, favicon.svg
DELETED: deploy/, nix/, deno.json, svelte.config.js, .deploy.env.example,
         src/routes/+page.server.ts, docs OCI spec + plans
```

---

### Task 1: Demolition + template scaffold adoption

**Files:**

- Delete: `deploy/` (entire dir incl. tfstate), `nix/`, `deno.json`, `svelte.config.js`, `.deploy.env.example`, `docs/superpowers/specs/2026-05-21-oci-deploy-via-nixos-modules-design.md`, `docs/superpowers/plans/` OCI plan files (any plan file mentioning OCI/NixOS — NOT this plan)
- Create (copy from `~/Desktop/coding/templates/cf-site/`): `vite.config.ts` (overwrite), `tsconfig.json` (overwrite), `prettier.config.js`, `.npmrc`, `.prettierignore`, `scripts/sync-secrets.sh`, `.github/workflows/deploy.yml`, `worker-configuration.d.ts`
- Modify: `package.json`, `wrangler.jsonc` (new), `justfile` (rewrite), `.gitignore`, `.env.tpl` (new), `src/app.d.ts` (new)

**Interfaces:**

- Produces: a repo where `bun install` and `bunx svelte-kit sync` succeed; `platform.env` is typed as `Env & { NOTION_API_KEY?: string }` with `Env.CACHE: R2Bucket`. Type-check/build stays red until Task 6–7 removes Deno globals from `src/lib/server/` — that is expected.

- [ ] **Step 1: Commit the pre-existing working-tree changes** (mobile layout tweaks etc. — don't mix them into migration commits)

```bash
git add -A && git commit -m "chore: pre-migration snapshot (pending mobile tweaks + OCI leftovers)"
```

- [ ] **Step 2: Delete the dead stacks and Deno config**

```bash
git rm -r deploy nix
git rm deno.json svelte.config.js .deploy.env.example
git rm docs/superpowers/specs/2026-05-21-oci-deploy-via-nixos-modules-design.md
ls docs/superpowers/plans/   # git rm any OCI/NixOS plan files listed (keep 2026-07-08-cloudflare-migration.md)
rm -f deno.lock && git rm --cached deno.lock 2>/dev/null || true
```

- [ ] **Step 3: Copy template config files verbatim**

```bash
T=~/Desktop/coding/templates/cf-site
cp $T/vite.config.ts $T/tsconfig.json $T/prettier.config.js $T/.npmrc $T/.prettierignore $T/worker-configuration.d.ts .
mkdir -p scripts .github/workflows
cp $T/scripts/sync-secrets.sh scripts/ && chmod +x scripts/sync-secrets.sh
cp $T/.github/workflows/deploy.yml .github/workflows/
cp $T/src/app.d.ts src/app.d.ts
```

- [ ] **Step 4: Write `package.json`** (template scripts/devDeps + this app's runtime deps)

```json
{
	"name": "task-burndown",
	"private": true,
	"version": "0.1.0",
	"type": "module",
	"scripts": {
		"dev": "vite dev",
		"build": "wrangler types --check && vite build",
		"preview": "wrangler dev .svelte-kit/cloudflare/_worker.js --port 4173",
		"prepare": "svelte-kit sync || echo ''",
		"check": "wrangler types --check && svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
		"check:watch": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --watch",
		"lint": "prettier --check .",
		"format": "prettier --write .",
		"test:unit": "vitest",
		"test": "bun run test:unit -- --run",
		"gen": "wrangler types"
	},
	"dependencies": {
		"chart.js": "^4.5.1",
		"chartjs-adapter-dayjs-4": "^1.0.4",
		"chartjs-plugin-zoom": "^2.2.0",
		"dayjs": "^1.11.20",
		"svelte-chartjs": "^4.0.1"
	},
	"devDependencies": {
		"@resvg/resvg-js": "^2.6.2",
		"@sveltejs/adapter-cloudflare": "^7.2.8",
		"@sveltejs/kit": "^2.63.0",
		"@sveltejs/vite-plugin-svelte": "^7.1.2",
		"@tailwindcss/vite": "^4.3.0",
		"prettier": "^3.8.3",
		"prettier-plugin-svelte": "^4.1.0",
		"prettier-plugin-tailwindcss": "^0.8.0",
		"svelte": "^5.56.1",
		"svelte-check": "^4.6.0",
		"tailwindcss": "^4.3.0",
		"typescript": "^6.0.3",
		"vite": "^8.0.16",
		"vitest": "^4.1.8",
		"wrangler": "^4.97.0"
	}
}
```

(If `grep -rn "svelte-chartjs" src/` returns nothing, drop that dependency.)

- [ ] **Step 5: Write `wrangler.jsonc`** (template + R2 binding + name)

```jsonc
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "task-burndown",
	"compatibility_date": "2026-07-06",
	"compatibility_flags": ["nodejs_als"],
	"main": ".svelte-kit/cloudflare/_worker.js",
	"assets": {
		"binding": "ASSETS",
		"directory": ".svelte-kit/cloudflare"
	},
	"workers_dev": true,
	"preview_urls": true,
	"r2_buckets": [{ "binding": "CACHE", "bucket_name": "task-burndown-cache" }]
}
```

- [ ] **Step 6: Edit `src/app.d.ts`** so the Notion secret is typed on `platform.env`

```ts
// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Platform {
			env: Env & { NOTION_API_KEY?: string };
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}
	}
}

export {};
```

- [ ] **Step 7: Write `justfile`** (template verbs + project-specific `setup`)

```make
set shell := ["bash", "-cu"]

default:
    @just --list

# Dev server (secrets injected if .env.tpl has any)
dev:
    op run --env-file=.env.tpl -- bun run dev

test:
    bun run test

# All static analysis: wrangler types + svelte-check + prettier (read-only)
check:
    bun run check && bun run lint

fmt:
    bun run format

build:
    bun run build

# Stream logs from the deployed Worker
logs:
    bunx wrangler tail

# Push .env.tpl secrets to the Worker (no plaintext touches disk)
sync-secrets:
    ./scripts/sync-secrets.sh

deploy: test build
    bunx wrangler deploy

# --- project-specific recipes below (one-offs live in scripts/, run directly) ---

# One-time bootstrap: create the R2 bucket and seed local + prod caches from
# the legacy notion-cache.json (raw pages) in the repo root.
setup:
    bunx wrangler r2 bucket create task-burndown-cache || true
    bun run prepare
    bun scripts/seed-cache.ts
    bunx wrangler r2 object put task-burndown-cache/task-cache.json --file /tmp/task-cache-seed.json --local
    bunx wrangler r2 object put task-burndown-cache/task-cache.json --file /tmp/task-cache-seed.json --remote
```

- [ ] **Step 8: Write `.env.tpl`** (note: never a literal `op://` in comments — breaks `op inject`)

```bash
# Canonical secrets manifest — 1Password secret references only, SAFE to commit.
# Local dev:      op run --env-file=.env.tpl -- bun run dev
# Push to CF:     just sync-secrets
NOTION_API_KEY=op://Task Burndown/Notion Task Burndown Chart Notion Internal Integration Secret/credential
```

- [ ] **Step 9: Edit `.github/workflows/deploy.yml`** — replace the two `CHANGEME-vault` refs:

```yaml
CLOUDFLARE_API_TOKEN: op://Task Burndown/cloudflare/api-token
CLOUDFLARE_ACCOUNT_ID: op://Task Burndown/cloudflare/account-id
```

- [ ] **Step 10: Rewrite `.gitignore`** (template's + this repo's extras)

```gitignore
node_modules

# Output
.output
.wrangler
/.svelte-kit
/build

# OS
.DS_Store
Thumbs.db

# Env
.env
.env.*
# 1Password secrets manifest (op:// refs only) IS committed
!.env.tpl

# Vite
vite.config.js.timestamp-*
vite.config.ts.timestamp-*

# Legacy raw-pages cache (kept locally as the seed source)
notion-cache.json
```

- [ ] **Step 11: Install and sync; regenerate worker types**

```bash
bun install && bunx svelte-kit sync && bun run gen
```

Expected: install succeeds; `worker-configuration.d.ts` now contains `interface Env { CACHE: R2Bucket; }` (verify with `grep -n "CACHE" worker-configuration.d.ts`). `bun run check` is expected RED (Deno globals in `src/lib/server/`) until Tasks 6–7.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: adopt cf-site scaffold, drop Deno/OCI/nix stacks"
```

---

### Task 2: Port all tests to vitest

**Files:**

- Modify: `src/lib/data/calculator.test.ts`, `src/lib/data/events.test.ts`, `src/lib/data/preferences.test.ts`, `src/lib/data/presets.test.ts`, `src/lib/data/timezone.test.ts`, `src/lib/server/refresh-policy.test.ts`, `src/lib/server/notion.test.ts`
- Delete: `src/lib/server/cache.test.ts` (it only tests `getCachePath`, which dies in Task 6; R2 tests replace it there)

**Interfaces:**

- Produces: `bun run test` green. No source-file changes in this task.

- [ ] **Step 1: Apply the mechanical transform to each listed test file**

Per file, three edits (no logic changes):

1. `import { assertEquals } from "@std/assert";` → `import { expect, test } from "vitest";`
2. Every `Deno.test(` → `test(`
3. Every `assertEquals(A, B)` → `expect(A).toEqual(B)` (assertEquals calls may span lines — the first argument becomes the `expect()` argument, the second the `toEqual()` argument)

Example, `src/lib/server/refresh-policy.test.ts` before/after:

```ts
// before
import { assertEquals } from '@std/assert';
Deno.test('forceFull always wins', () => {
	assertEquals(
		shouldFullRefresh({
			forceFull: true,
			hasCache: true,
			lastFullRefreshAt: NOW.toISOString(),
			now: NOW
		}),
		true
	);
});
// after
import { expect, test } from 'vitest';
test('forceFull always wins', () => {
	expect(
		shouldFullRefresh({
			forceFull: true,
			hasCache: true,
			lastFullRefreshAt: NOW.toISOString(),
			now: NOW
		})
	).toEqual(true);
});
```

If a test uses any other `Deno.*` API (e.g. `Deno.env` in preferences tests), replace with a plain stub (e.g. assign `globalThis.localStorage` a Map-backed fake) — inspect each file, don't assume.

- [ ] **Step 2: Delete the obsolete cache test**

```bash
git rm src/lib/server/cache.test.ts
```

- [ ] **Step 3: Run the suite**

```bash
bun run test
```

Expected: PASS, 7 test files. If vitest fails to resolve `./x.ts`-style imports, the tsconfig from Task 1 (`rewriteRelativeImportExtensions`) plus the sveltekit plugin handles it — investigate before changing imports.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test: port unit tests from deno test to vitest"
```

---

### Task 3: Task.lastEditedTime + unfiltered parseTasks + TaskCache type

**Files:**

- Modify: `src/lib/types.ts`, `src/lib/data/parser.ts`
- Create: `src/lib/data/parser.test.ts`

**Interfaces:**

- Produces: `Task.lastEditedTime: string`; `interface TaskCache extends ParsedData { lastFullRefreshAt: string | null }`; `parseTasks(pages: NotionPage[]): ParsedData` now returns **unfiltered** tasks; `export const PRIORITY_ORDER = ["High", "Medium", "Low", "(No Priority)"]` from `parser.ts`. Consumers must apply `applyBaseFilters` themselves (client does this in Task 9).

- [ ] **Step 1: Write the failing tests** — `src/lib/data/parser.test.ts`

```ts
import { expect, test } from 'vitest';
import { parseTasks } from './parser.ts';
import type { NotionPage } from '$lib/types.js';

function makePage(overrides: Partial<NotionPage> = {}): NotionPage {
	return {
		id: 'p1',
		created_time: '2026-01-02T03:04:05.000Z',
		last_edited_time: '2026-02-03T04:05:06.000Z',
		archived: false,
		in_trash: false,
		url: '',
		properties: {
			'Date Created': { created_time: '2026-01-02T03:04:05.000Z' },
			'Completed Date': { date: null },
			'Due Date': { date: null },
			Status: { status: { name: 'Not started' } },
			Tags: { multi_select: [{ name: 'Alpha', color: 'blue' }] },
			Priority: { select: { name: 'High' } },
			'Tag & Date History': { rich_text: [] },
			'Project Title': { rollup: { array: [] } }
		},
		...overrides
	};
}

test('parseTasks carries last_edited_time onto the task', () => {
	const { tasks } = parseTasks([makePage()]);
	expect(tasks[0].lastEditedTime).toEqual('2026-02-03T04:05:06.000Z');
});

test('parseTasks no longer applies base filters (cancelled tasks stay)', () => {
	const cancelled = makePage({
		id: 'p2',
		properties: { ...makePage().properties, Status: { status: { name: 'Cancelled' } } }
	});
	const { tasks } = parseTasks([makePage(), cancelled]);
	expect(tasks.length).toEqual(2);
});
```

- [ ] **Step 2: Run to verify failure**

```bash
bunx vitest run src/lib/data/parser.test.ts
```

Expected: FAIL — `lastEditedTime` undefined, and length 1 (filter still applied).

- [ ] **Step 3: Implement**

In `src/lib/types.ts`, add to `Task`:

```ts
lastEditedTime: string;
```

and after `ParsedData`:

```ts
export interface TaskCache extends ParsedData {
	lastFullRefreshAt: string | null;
}
```

In `src/lib/data/parser.ts`:

- Remove the `applyBaseFilters` import.
- In `parseTask`'s return object add `lastEditedTime: page.last_edited_time,`.
- In `parseTasks`, replace `const tasks = applyBaseFilters(allParsed);` with `const tasks = allParsed;`.
- Replace the hardcoded priority array with an exported constant used in place:

```ts
export const PRIORITY_ORDER = ["High", "Medium", "Low", "(No Priority)"];
// ...
    allPriorities: PRIORITY_ORDER.filter((p) => allPrioritiesSet.has(p)),
```

- [ ] **Step 4: Run tests**

```bash
bun run test
```

Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(parser): emit lastEditedTime, stop base-filtering, add TaskCache type"
```

---

### Task 4: merge.ts — task-level merge + incremental threshold

**Files:**

- Create: `src/lib/data/merge.ts`, `src/lib/data/merge.test.ts`
- Modify: `src/lib/server/notion.ts` (delete `mergePages`, `getIncrementalSinceDate`), `src/lib/server/notion.test.ts` (delete their tests)

**Interfaces:**

- Consumes: `Task`, `ParsedData`, `PRIORITY_ORDER` (Task 3).
- Produces:
  - `mergeParsedData(base: ParsedData, fresh: ParsedData): ParsedData` — tasks merged by id (fresh wins), tags/projects sorted set-union, priorities in `PRIORITY_ORDER`, `tagColors` object-spread (fresh wins).
  - `getIncrementalSince(tasks: Task[]): string | null` — earlier of `max(created)` and `max(lastEditedTime)`; null for empty input. (Same semantics as the deleted page-based `getIncrementalSinceDate`.)
- Used by the server (incremental merge, Task 7) AND the client (chunk accumulation, Task 9) — hence `src/lib/data/`, pure.

- [ ] **Step 1: Write failing tests** — `src/lib/data/merge.test.ts`

```ts
import { expect, test } from 'vitest';
import { getIncrementalSince, mergeParsedData } from './merge.ts';
import type { ParsedData, Task } from '$lib/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: 't1',
		created: '2026-01-01T00:00:00.000Z',
		completed: null,
		dueDate: null,
		status: 'Not started',
		tags: [],
		priority: '(No Priority)',
		projectName: '(No Project)',
		history: [],
		hasProject: false,
		lastEditedTime: '2026-01-02T00:00:00.000Z',
		...overrides
	};
}
function makeParsed(overrides: Partial<ParsedData> = {}): ParsedData {
	return {
		tasks: [],
		allTags: [],
		allPriorities: [],
		allProjects: [],
		tagColors: {},
		...overrides
	};
}

test('mergeParsedData: fresh task replaces cached task with same id', () => {
	const base = makeParsed({ tasks: [makeTask({ status: 'Not started' })] });
	const fresh = makeParsed({ tasks: [makeTask({ status: 'Done' })] });
	const merged = mergeParsedData(base, fresh);
	expect(merged.tasks.length).toEqual(1);
	expect(merged.tasks[0].status).toEqual('Done');
});

test('mergeParsedData: unions metadata', () => {
	const base = makeParsed({
		allTags: ['Alpha'],
		allPriorities: ['High'],
		allProjects: ['A'],
		tagColors: { Alpha: 'blue' }
	});
	const fresh = makeParsed({
		allTags: ['Beta'],
		allPriorities: ['Low'],
		allProjects: ['B'],
		tagColors: { Beta: 'red' }
	});
	const merged = mergeParsedData(base, fresh);
	expect(merged.allTags).toEqual(['Alpha', 'Beta']);
	expect(merged.allPriorities).toEqual(['High', 'Low']);
	expect(merged.allProjects).toEqual(['A', 'B']);
	expect(merged.tagColors).toEqual({ Alpha: 'blue', Beta: 'red' });
});

test('getIncrementalSince: earlier of the two maxima', () => {
	const tasks = [
		makeTask({
			id: 'a',
			created: '2026-01-05T00:00:00.000Z',
			lastEditedTime: '2026-01-06T00:00:00.000Z'
		}),
		makeTask({
			id: 'b',
			created: '2026-01-01T00:00:00.000Z',
			lastEditedTime: '2026-01-09T00:00:00.000Z'
		})
	];
	// max(created)=01-05, max(edited)=01-09 -> earlier is 01-05
	expect(getIncrementalSince(tasks)).toEqual('2026-01-05T00:00:00.000Z');
});

test('getIncrementalSince: null for empty', () => {
	expect(getIncrementalSince([])).toEqual(null);
});
```

- [ ] **Step 2: Run to verify failure** — `bunx vitest run src/lib/data/merge.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement** — `src/lib/data/merge.ts`

```ts
import type { ParsedData, Task } from '$lib/types.js';
import { PRIORITY_ORDER } from './parser.js';

export function mergeParsedData(base: ParsedData, fresh: ParsedData): ParsedData {
	const byId = new Map<string, Task>();
	for (const t of base.tasks) byId.set(t.id, t);
	for (const t of fresh.tasks) byId.set(t.id, t);
	return {
		tasks: [...byId.values()],
		allTags: [...new Set([...base.allTags, ...fresh.allTags])].sort(),
		allPriorities: PRIORITY_ORDER.filter(
			(p) => base.allPriorities.includes(p) || fresh.allPriorities.includes(p)
		),
		allProjects: [...new Set([...base.allProjects, ...fresh.allProjects])].sort(),
		tagColors: { ...base.tagColors, ...fresh.tagColors }
	};
}

/** Earlier of max(created) / max(lastEditedTime) — mirrors the old page-based threshold. */
export function getIncrementalSince(tasks: Task[]): string | null {
	if (tasks.length === 0) return null;
	let maxCreated = '';
	let maxEdited = '';
	for (const t of tasks) {
		if (t.created > maxCreated) maxCreated = t.created;
		if (t.lastEditedTime > maxEdited) maxEdited = t.lastEditedTime;
	}
	return maxCreated < maxEdited ? maxCreated : maxEdited;
}
```

- [ ] **Step 4: Remove the superseded page-level functions**

In `src/lib/server/notion.ts` delete `mergePages` and `getIncrementalSinceDate`. In `src/lib/server/notion.test.ts` delete their tests (leave the file if other tests remain; `git rm` it if now empty).

- [ ] **Step 5: Run full suite** — `bun run test` → PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(data): add task-level mergeParsedData + getIncrementalSince"
```

---

### Task 5: notion.ts fetchPageChunk

**Files:**

- Modify: `src/lib/server/notion.ts`
- Create/modify: `src/lib/server/notion.test.ts`

**Interfaces:**

- Produces: `fetchPageChunk(apiKey: string, cursor: string | null, maxRequests?: number): Promise<{ pages: NotionPage[]; nextCursor: string | null }>` — up to `maxRequests` (default 3) sequential Notion query calls, resuming from `cursor`. `fetchAllPages` and `fetchIncrementalPages` stay as-is (`fetchAllPages` is used by the seed script only).

- [ ] **Step 1: Write failing test** (append to `src/lib/server/notion.test.ts`, creating the file if Task 4 removed it)

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { fetchPageChunk } from './notion.ts';

function notionResponse(ids: string[], nextCursor: string | null) {
	return new Response(
		JSON.stringify({
			results: ids.map((id) => ({
				id,
				created_time: '',
				last_edited_time: '',
				properties: {},
				archived: false,
				in_trash: false,
				url: ''
			})),
			has_more: nextCursor !== null,
			next_cursor: nextCursor
		}),
		{ status: 200 }
	);
}

afterEach(() => vi.unstubAllGlobals());

test('fetchPageChunk stops after maxRequests and returns the cursor', async () => {
	const fetchMock = vi
		.fn()
		.mockResolvedValueOnce(notionResponse(['a'], 'c1'))
		.mockResolvedValueOnce(notionResponse(['b'], 'c2'))
		.mockResolvedValueOnce(notionResponse(['c'], 'c3'));
	vi.stubGlobal('fetch', fetchMock);
	const chunk = await fetchPageChunk('key', null, 3);
	expect(fetchMock.mock.calls.length).toEqual(3);
	expect(chunk.pages.map((p) => p.id)).toEqual(['a', 'b', 'c']);
	expect(chunk.nextCursor).toEqual('c3');
});

test('fetchPageChunk returns null cursor when Notion is exhausted early', async () => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(notionResponse(['a'], null)));
	const chunk = await fetchPageChunk('key', null, 3);
	expect(chunk.pages.map((p) => p.id)).toEqual(['a']);
	expect(chunk.nextCursor).toEqual(null);
});

test('fetchPageChunk resumes from a given cursor', async () => {
	const fetchMock = vi.fn().mockResolvedValueOnce(notionResponse(['z'], null));
	vi.stubGlobal('fetch', fetchMock);
	await fetchPageChunk('key', 'resume-me', 3);
	const body = JSON.parse(fetchMock.mock.calls[0][1].body);
	expect(body.start_cursor).toEqual('resume-me');
});
```

- [ ] **Step 2: Run to verify failure** — `bunx vitest run src/lib/server/notion.test.ts` → FAIL (`fetchPageChunk` not exported)

- [ ] **Step 3: Implement** (append to `src/lib/server/notion.ts`; reuse `apiHeaders`/`QUERY_URL`)

```ts
export interface PageChunk {
	pages: NotionPage[];
	nextCursor: string | null;
}

/**
 * Fetch up to maxRequests pagination steps of the full-database query.
 * ponytail: 3 requests/chunk keeps each Worker invocation ~4-6ms CPU and 3
 * subrequests — the client loops with nextCursor until null.
 */
export async function fetchPageChunk(
	apiKey: string,
	cursor: string | null,
	maxRequests = 3
): Promise<PageChunk> {
	const pages: NotionPage[] = [];
	let startCursor = cursor ?? undefined;
	for (let i = 0; i < maxRequests; i++) {
		const body: Record<string, unknown> = {};
		if (startCursor) body.start_cursor = startCursor;
		const response = await fetch(QUERY_URL, {
			method: 'POST',
			headers: apiHeaders(apiKey),
			body: JSON.stringify(body)
		});
		if (!response.ok) {
			throw new Error(`Notion API error ${response.status}: ${await response.text()}`);
		}
		const data = await response.json();
		pages.push(...(data.results as NotionPage[]));
		startCursor = data.next_cursor ?? undefined;
		if (!(data.has_more ?? false)) return { pages, nextCursor: null };
	}
	return { pages, nextCursor: startCursor ?? null };
}
```

- [ ] **Step 4: Run suite** — `bun run test` → PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(notion): add fetchPageChunk for client-driven full sync"
```

---

### Task 6: cache.ts on R2 + secrets.ts env-only

**Files:**

- Rewrite: `src/lib/server/cache.ts`, `src/lib/server/secrets.ts`
- Create: `src/lib/server/cache.test.ts`

**Interfaces:**

- Consumes: `TaskCache` (Task 3).
- Produces:
  - `CACHE_KEY = "task-cache.json"`, `EMPTY_CACHE: TaskCache`
  - `readCache(bucket: R2Bucket): Promise<TaskCache>` (missing object → `EMPTY_CACHE`)
  - `writeCache(bucket: R2Bucket, data: TaskCache): Promise<void>`
  - `getNotionApiKey(env: { NOTION_API_KEY?: string }): string` — **now synchronous**; `platform.env` first, `process.env` fallback (vite dev under `op run`), throws if absent.

- [ ] **Step 1: Write failing tests** — `src/lib/server/cache.test.ts`

```ts
import { expect, test } from 'vitest';
import { CACHE_KEY, EMPTY_CACHE, readCache, writeCache } from './cache.ts';
import type { TaskCache } from '$lib/types.js';

function fakeBucket() {
	const store = new Map<string, string>();
	return {
		store,
		async get(key: string) {
			const v = store.get(key);
			return v === undefined ? null : { json: async () => JSON.parse(v) };
		},
		async put(key: string, value: string) {
			store.set(key, value);
		}
	};
}

test('readCache returns EMPTY_CACHE when object missing', async () => {
	const bucket = fakeBucket();
	expect(await readCache(bucket as unknown as R2Bucket)).toEqual(EMPTY_CACHE);
});

test('writeCache then readCache round-trips', async () => {
	const bucket = fakeBucket();
	const data: TaskCache = { ...EMPTY_CACHE, lastFullRefreshAt: '2026-07-08T00:00:00.000Z' };
	await writeCache(bucket as unknown as R2Bucket, data);
	expect(bucket.store.has(CACHE_KEY)).toEqual(true);
	expect(await readCache(bucket as unknown as R2Bucket)).toEqual(data);
});
```

- [ ] **Step 2: Run to verify failure** — `bunx vitest run src/lib/server/cache.test.ts` → FAIL

- [ ] **Step 3: Rewrite `src/lib/server/cache.ts`**

```ts
import type { TaskCache } from '$lib/types.js';

export const CACHE_KEY = 'task-cache.json';

export const EMPTY_CACHE: TaskCache = {
	lastFullRefreshAt: null,
	tasks: [],
	allTags: [],
	allPriorities: [],
	allProjects: [],
	tagColors: {}
};

export async function readCache(bucket: R2Bucket): Promise<TaskCache> {
	const obj = await bucket.get(CACHE_KEY);
	if (!obj) return EMPTY_CACHE;
	return (await obj.json()) as TaskCache;
}

export async function writeCache(bucket: R2Bucket, data: TaskCache): Promise<void> {
	await bucket.put(CACHE_KEY, JSON.stringify(data), {
		httpMetadata: { contentType: 'application/json' }
	});
}
```

- [ ] **Step 4: Rewrite `src/lib/server/secrets.ts`**

```ts
/** Prod: Worker secret on platform.env. Dev: process env injected by `op run`. */
export function getNotionApiKey(env: { NOTION_API_KEY?: string }): string {
	const key =
		env.NOTION_API_KEY ??
		(globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
			?.NOTION_API_KEY;
	if (!key) throw new Error('NOTION_API_KEY is not set (Worker secret or op run env)');
	return key;
}
```

- [ ] **Step 5: Run suite** — `bun run test` → PASS

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(server): R2-backed cache + env-only secret lookup"
```

---

### Task 7: API endpoints

**Files:**

- Create: `src/routes/api/tasks/+server.ts`, `src/routes/api/refresh-chunk/+server.ts`, `src/routes/api/cache/+server.ts`, `src/routes/api/refresh/refresh.test.ts`
- Rewrite: `src/routes/api/refresh/+server.ts`
- Delete: `src/routes/+page.server.ts`

**Interfaces:**

- Consumes: everything from Tasks 3–6.
- Produces (client contract for Task 9):
  - `GET /api/tasks` → `TaskCache` JSON (streamed from R2; `EMPTY_CACHE` if unseeded)
  - `POST /api/refresh?since=<iso>` → `{ needsFull: true }` when cache empty or (no `since` and 24h-stale); else merges incremental and returns `{ needsFull: false, freshCount: number, lastFullRefreshAt: string | null }`
  - `POST /api/refresh-chunk[?cursor=<c>]` → `ParsedData & { nextCursor: string | null }`
  - `PUT /api/cache` (body: full `TaskCache` JSON) → `{ ok: true }` | 400

- [ ] **Step 1: Write failing handler tests** — `src/routes/api/refresh/refresh.test.ts`

```ts
import { afterEach, expect, test, vi } from 'vitest';
import { POST } from './+server.ts';
import { CACHE_KEY, EMPTY_CACHE } from '$lib/server/cache.js';

function fakeBucket(initial?: string) {
	const store = new Map<string, string>();
	if (initial !== undefined) store.set(CACHE_KEY, initial);
	return {
		store,
		async get(key: string) {
			const v = store.get(key);
			return v === undefined ? null : { json: async () => JSON.parse(v) };
		},
		async put(key: string, value: string) {
			store.set(key, value);
		}
	};
}
function makeEvent(bucket: ReturnType<typeof fakeBucket>, search = '') {
	return {
		url: new URL(`http://x/api/refresh${search}`),
		platform: { env: { CACHE: bucket, NOTION_API_KEY: 'k' } }
	} as never;
}
const task = {
	id: 't1',
	created: '2026-07-01T00:00:00.000Z',
	completed: null,
	dueDate: null,
	status: 'Not started',
	tags: [],
	priority: '(No Priority)',
	projectName: '(No Project)',
	history: [],
	hasProject: false,
	lastEditedTime: '2026-07-02T00:00:00.000Z'
};

afterEach(() => vi.unstubAllGlobals());

test('empty cache -> needsFull, no Notion call', async () => {
	const fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	const res = await POST(makeEvent(fakeBucket(), '?since=2026-07-08'));
	expect(await res.json()).toEqual({ needsFull: true });
	expect(fetchMock.mock.calls.length).toEqual(0);
});

test('stale cache without since -> needsFull', async () => {
	const cache = { ...EMPTY_CACHE, tasks: [task], lastFullRefreshAt: '2020-01-01T00:00:00.000Z' };
	const res = await POST(makeEvent(fakeBucket(JSON.stringify(cache))));
	expect(await res.json()).toEqual({ needsFull: true });
});

test('explicit since -> incremental merge, cache written', async () => {
	const cache = { ...EMPTY_CACHE, tasks: [task], lastFullRefreshAt: '2026-07-08T00:00:00.000Z' };
	const bucket = fakeBucket(JSON.stringify(cache));
	const freshPage = {
		id: 't2',
		created_time: '2026-07-08T01:00:00.000Z',
		last_edited_time: '2026-07-08T01:00:00.000Z',
		archived: false,
		in_trash: false,
		url: '',
		properties: {
			'Date Created': { created_time: '2026-07-08T01:00:00.000Z' },
			'Completed Date': { date: null },
			'Due Date': { date: null },
			Status: { status: { name: 'Not started' } },
			Tags: { multi_select: [] },
			Priority: { select: null },
			'Tag & Date History': { rich_text: [] },
			'Project Title': { rollup: { array: [] } }
		}
	};
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ results: [freshPage], has_more: false, next_cursor: null }), {
				status: 200
			})
		)
	);
	const res = await POST(makeEvent(bucket, '?since=2026-07-08T00:00:00.000Z'));
	const body = await res.json();
	expect(body.needsFull).toEqual(false);
	expect(body.freshCount).toEqual(1);
	const written = JSON.parse(bucket.store.get(CACHE_KEY)!);
	expect(written.tasks.length).toEqual(2);
	expect(written.lastFullRefreshAt).toEqual('2026-07-08T00:00:00.000Z'); // unchanged by incremental
});
```

- [ ] **Step 2: Run to verify failure** — `bunx vitest run src/routes/api/refresh/refresh.test.ts` → FAIL (handler still uses the old raw-page flow / Deno cache signatures)

- [ ] **Step 3: Rewrite `src/routes/api/refresh/+server.ts`**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNotionApiKey } from '$lib/server/secrets.js';
import { readCache, writeCache } from '$lib/server/cache.js';
import { fetchIncrementalPages } from '$lib/server/notion.js';
import { shouldFullRefresh } from '$lib/server/refresh-policy.js';
import { parseTasks } from '$lib/data/parser.js';
import { getIncrementalSince, mergeParsedData } from '$lib/data/merge.js';

export const POST: RequestHandler = async ({ url, platform }) => {
	const env = platform!.env;
	const sinceParam = url.searchParams.get('since');
	const cache = await readCache(env.CACHE);
	const hasCache = cache.tasks.length > 0;

	// Full syncs are the client's job (chunked loop) — this endpoint only says so.
	const needsFull =
		!hasCache ||
		(sinceParam === null &&
			shouldFullRefresh({
				forceFull: false,
				hasCache,
				lastFullRefreshAt: cache.lastFullRefreshAt
			}));
	if (needsFull) return json({ needsFull: true });

	const since = sinceParam ?? getIncrementalSince(cache.tasks)!;
	const fresh = await fetchIncrementalPages(getNotionApiKey(env), since);
	const merged = mergeParsedData(cache, parseTasks(fresh));
	const data = { ...merged, lastFullRefreshAt: cache.lastFullRefreshAt };
	await writeCache(env.CACHE, data);
	return json({
		needsFull: false,
		freshCount: fresh.length,
		lastFullRefreshAt: data.lastFullRefreshAt
	});
};
```

- [ ] **Step 4: Create `src/routes/api/tasks/+server.ts`**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { CACHE_KEY, EMPTY_CACHE } from '$lib/server/cache.js';

export const GET: RequestHandler = async ({ platform }) => {
	const obj = await platform!.env.CACHE.get(CACHE_KEY);
	if (!obj) return json(EMPTY_CACHE);
	// Stream the R2 body straight through — ~0 CPU; the client parses.
	return new Response(obj.body, { headers: { 'content-type': 'application/json' } });
};
```

- [ ] **Step 5: Create `src/routes/api/refresh-chunk/+server.ts`**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { getNotionApiKey } from '$lib/server/secrets.js';
import { fetchPageChunk } from '$lib/server/notion.js';
import { parseTasks } from '$lib/data/parser.js';

export const POST: RequestHandler = async ({ url, platform }) => {
	const cursor = url.searchParams.get('cursor');
	const chunk = await fetchPageChunk(getNotionApiKey(platform!.env), cursor);
	return json({ ...parseTasks(chunk.pages), nextCursor: chunk.nextCursor });
};
```

- [ ] **Step 6: Create `src/routes/api/cache/+server.ts`**

```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { CACHE_KEY } from '$lib/server/cache.js';

export const PUT: RequestHandler = async ({ request, platform }) => {
	const text = await request.text();
	// ponytail: cheap sanity gate, not schema validation — CF Access already
	// restricts callers to Alex; this only guards against a truncated body.
	if (!text.startsWith('{') || text.length < 100) {
		return json({ error: 'bad cache body' }, { status: 400 });
	}
	await platform!.env.CACHE.put(CACHE_KEY, text, {
		httpMetadata: { contentType: 'application/json' }
	});
	return json({ ok: true });
};
```

- [ ] **Step 7: Delete the server load** — `git rm src/routes/+page.server.ts`

- [ ] **Step 8: Run suite + static analysis (first fully-green gate)**

```bash
bun run test && bun run check
```

Expected: tests PASS; `check` passes — no Deno symbols remain anywhere. If `check` flags `+page.svelte` (it still references `data`), that is Task 9's job; everything else must be clean.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(api): tasks stream, incremental refresh, chunked full-sync endpoints"
```

---

### Task 8: Seed script + `just setup`

**Files:**

- Create: `scripts/seed-cache.ts`

**Interfaces:**

- Consumes: `parseTasks` (Task 3); the legacy raw-pages `notion-cache.json` in the repo root (gitignored, 16.9 MB).
- Produces: `/tmp/task-cache-seed.json` in `TaskCache` shape; `just setup` (written in Task 1) uploads it to local + remote R2.

- [ ] **Step 1: Write `scripts/seed-cache.ts`**

```ts
// One-off: convert the legacy raw-pages cache file into the parsed TaskCache
// shape and stage it for `wrangler r2 object put` (see `just setup`).
// Run: bun scripts/seed-cache.ts   (bun resolves $lib via tsconfig paths;
// run `bun run prepare` first so .svelte-kit/tsconfig.json exists)
import { parseTasks } from '../src/lib/data/parser.ts';
import type { NotionPage, TaskCache } from '../src/lib/types.ts';

const raw = JSON.parse(await Bun.file('notion-cache.json').text());
const pages: NotionPage[] = Array.isArray(raw) ? raw : raw.pages;
const cache: TaskCache = {
	lastFullRefreshAt: Array.isArray(raw) ? null : (raw.lastFullRefreshAt ?? null),
	...parseTasks(pages)
};
await Bun.write('/tmp/task-cache-seed.json', JSON.stringify(cache));
console.log(
	`seeded ${cache.tasks.length} tasks from ${pages.length} pages -> /tmp/task-cache-seed.json`
);
```

- [ ] **Step 2: Run it and sanity-check the output**

```bash
bun run prepare && bun scripts/seed-cache.ts
```

Expected: `seeded 4302 tasks from 4302 pages ...` (task count = page count now that base filters are gone; ±a few if Notion changed since). If `$lib` resolution fails under Bun, change the two imports in `parser.ts`'s dependency chain? **No** — instead change the seed script's imports to relative paths only (it already is) and replace `parser.ts`'s internal `$lib/types.js` import with `../types.js` (same for `history.ts`/`filters.ts` if needed); relative imports inside `src/lib` are equivalent and Bun-safe.

- [ ] **Step 3: Seed local R2 only** (remote comes at deploy time)

```bash
bunx wrangler r2 object put task-burndown-cache/task-cache.json --file /tmp/task-cache-seed.json --local
```

Expected: object written under `.wrangler/state/`.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-cache.ts && git commit -m "feat(scripts): seed R2 task cache from legacy raw-pages file"
```

---

### Task 9: Client rework (+page.svelte)

**Files:**

- Modify: `src/routes/+page.svelte`

**Interfaces:**

- Consumes: `GET /api/tasks`, `POST /api/refresh`, `POST /api/refresh-chunk`, `PUT /api/cache` (Task 7 contract); `applyBaseFilters` (`$lib/data/filters.js`); `mergeParsedData` (`$lib/data/merge.js`); `TaskCache`/`ParsedData` types.
- Produces: the page no longer receives server data; everything loads client-side.

- [ ] **Step 1: Apply the script-block changes**

In `src/routes/+page.svelte` `<script>`:

1. Remove `const { data } = $props();` (and its `svelte-ignore` comment). Add imports:

```ts
import { applyBaseFilters } from '$lib/data/filters.js';
import { mergeParsedData } from '$lib/data/merge.js';
import type { ParsedData, TaskCache } from '$lib/types.js';
```

(`applyViewFilters` is already imported from the same module — merge the import statements.)

2. Replace the five data-seeded states with empty initials:

```ts
let allTasks: Task[] = $state([]);
let allTags: string[] = $state([]);
let allPriorities: string[] = $state(['High', 'Medium', 'Low', '(No Priority)']);
let allProjects: string[] = $state(['(No Project)']);
let tagColors: Record<string, string> = $state({});
```

3. Base filters now run client-side. Below the state block add:

```ts
let baseTasks = $derived(applyBaseFilters(allTasks));
```

and change the two consumers of raw `allTasks`:

```ts
let filteredTasks = $derived(
	applyViewFilters(baseTasks, {
		includeLegacy: false,
		includeIncomplete: true,
		includeProjectTasks
	})
);
let projectCount = $derived(baseTasks.filter((t) => t.hasProject).length);
```

Also update the two template usages: `{#if allTasks.length === 0}` → `{#if baseTasks.length === 0}` and the `{:else if allTasks.length > 0}` header check → `baseTasks.length > 0` (and the stats `{#if allTasks.length > 0}` likewise).

4. Replace `postRefresh`/`fullSync`/`refreshToday` wholesale with:

```ts
let syncProgress: number = $state(0);

function applyParsed(d: ParsedData) {
	allTasks = d.tasks;
	allTags = d.allTags;
	allPriorities = d.allPriorities;
	allProjects = d.allProjects;
	tagColors = d.tagColors;
}

async function loadTasks() {
	refreshError = null;
	try {
		const res = await fetch('/api/tasks');
		if (!res.ok) {
			refreshError = `${res.status}`;
			return;
		}
		applyParsed((await res.json()) as TaskCache);
	} catch (e) {
		refreshError = (e as Error).message;
	}
}

async function fullSync() {
	isFullSyncing = true;
	refreshError = null;
	syncProgress = 0;
	try {
		let merged: ParsedData | null = null;
		let cursor: string | null = null;
		do {
			const qs: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
			const res = await fetch(`/api/refresh-chunk${qs}`, { method: 'POST' });
			if (!res.ok) {
				refreshError = `${res.status}`;
				return;
			}
			const { nextCursor, ...chunk } = (await res.json()) as ParsedData & {
				nextCursor: string | null;
			};
			merged = merged ? mergeParsedData(merged, chunk) : chunk;
			cursor = nextCursor;
			syncProgress += 1;
		} while (cursor);
		const cacheData: TaskCache = {
			lastFullRefreshAt: new Date().toISOString(),
			...merged!
		};
		const put = await fetch('/api/cache', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(cacheData)
		});
		if (!put.ok) {
			refreshError = `${put.status}`;
			return;
		}
		applyParsed(cacheData);
	} catch (e) {
		refreshError = (e as Error).message;
	} finally {
		isFullSyncing = false;
	}
}

async function refreshToday() {
	isRefreshingToday = true;
	refreshError = null;
	try {
		const since = encodeURIComponent(getStartOfDayUTC(timezone));
		const res = await fetch(`/api/refresh?since=${since}`, { method: 'POST' });
		if (!res.ok) {
			refreshError = `${res.status}`;
			return;
		}
		const meta = (await res.json()) as { needsFull: boolean };
		if (meta.needsFull) {
			await fullSync(); // empty/stale cache bootstraps itself via the chunk loop
		} else {
			await loadTasks();
		}
	} catch (e) {
		refreshError = (e as Error).message;
	} finally {
		isRefreshingToday = false;
	}
}
```

5. In `onMount`, before `await refreshToday();` add:

```ts
await loadTasks(); // paint from R2 cache immediately, then sync today
```

6. Full Sync button label — show loop progress. Replace its `<span>` text `{isFullSyncing ? "Syncing" : "Full"}` with:

```svelte
{isFullSyncing ? `Sync ${syncProgress}` : 'Full'}
```

- [ ] **Step 2: Static analysis**

```bash
bun run check
```

Expected: PASS, 0 errors (this was the last `data`-typed consumer).

- [ ] **Step 3: Manual dev smoke against seeded local R2**

```bash
just dev
```

In the browser at `http://localhost:5173`:

- Chart renders immediately from the seeded cache (~3.7k filtered tasks; stats populated).
- "Today" button completes and the "Syncing" indicator clears (requires `op` signed in — the dev recipe injects `NOTION_API_KEY`).
- "Full" button counts up `Sync 1…15` and lands with a rendered chart; a second page reload still shows data (PUT persisted to local R2).

- [ ] **Step 4: Run full suite once more** — `bun run test` → PASS

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(client): load from /api/tasks, client-side base filters, chunked full sync"
```

---

### Task 10: PWA — manifest, icons, head links

**Files:**

- Create: `scripts/generate-icons.ts`, `static/manifest.webmanifest`, `static/icon-192.png`, `static/icon-512.png`, `static/apple-touch-icon.png`, `static/favicon.svg`
- Modify: `src/app.html`

**Interfaces:**

- Consumes: the heroicons clone at `~/Desktop/coding/reference-repos/heroicons/optimized/24/solid/chart-bar.svg`; color tokens from `src/app.css` (look up the actual values of `--color-void` — the page background — and `--color-bitcoin`; the literals below assume `#0a0a0c` / `#f7931a`, substitute the real ones).

- [ ] **Step 1: Write `scripts/generate-icons.ts`**

```ts
// One-off: render the homescreen/app icons. Run: bun scripts/generate-icons.ts
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const BG = '#0a0a0c'; // --color-void from src/app.css — keep in sync
const FG = '#f7931a'; // --color-bitcoin

const heroicon = readFileSync(
	`${process.env.HOME}/Desktop/coding/reference-repos/heroicons/optimized/24/solid/chart-bar.svg`,
	'utf8'
);
const path = heroicon.match(/<path[^>]*d="([^"]+)"/)![1];

// Full-bleed square: iOS masks its own corners on apple-touch-icon.
// Glyph occupies the middle ~55% of the canvas.
function iconSvg(size: number): string {
	const glyph = size * 0.55;
	const offset = (size - glyph) / 2;
	const scale = glyph / 24;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="${path}" fill="${FG}"/>
  </g>
</svg>`;
}

for (const [file, size] of [
	['static/icon-192.png', 192],
	['static/icon-512.png', 512],
	['static/apple-touch-icon.png', 180]
] as const) {
	writeFileSync(file, new Resvg(iconSvg(size)).render().asPng());
	console.log(`wrote ${file}`);
}

// Browser-tab favicon: transparent background, just the glyph.
writeFileSync(
	'static/favicon.svg',
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}" fill="${FG}"/></svg>`
);
console.log('wrote static/favicon.svg');
```

- [ ] **Step 2: Check the real token values, then generate**

```bash
grep -n "color-void\|color-bitcoin" src/app.css   # update BG/FG constants to match
bun scripts/generate-icons.ts
```

Expected: four `wrote static/...` lines. Eyeball `static/icon-512.png` (open it) — orange chart-bar on near-black.

- [ ] **Step 3: Write `static/manifest.webmanifest`** (background/theme = the real `--color-void`)

```json
{
	"name": "Task Burndown",
	"short_name": "Burndown",
	"display": "standalone",
	"start_url": "/",
	"background_color": "#0a0a0c",
	"theme_color": "#0a0a0c",
	"icons": [
		{ "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
		{ "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
	]
}
```

- [ ] **Step 4: Add head links in `src/app.html`** — insert directly above `%sveltekit.head%`:

```html
<!-- use-credentials: manifest fetches are credentialless by default and
         CF Access would bounce them to the login page -->
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<meta name="theme-color" content="#0a0a0c" />
```

- [ ] **Step 5: Verify in dev**

```bash
just dev
```

`curl -s http://localhost:5173/manifest.webmanifest | head -3` returns the JSON; the tab shows the favicon.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(pwa): manifest, generated chart-bar icons, head links"
```

---

### Task 11: Rewrite CLAUDE.md and README

**Files:**

- Rewrite: `CLAUDE.md`, `README.md`

**Interfaces:**

- Consumes: final state of Tasks 1–10.

- [ ] **Step 1: Rewrite `CLAUDE.md`** to describe the new reality. Keep the accurate sections (Architecture's data-processing modules, Key Concepts, Code Conventions) and replace everything stale:
  - Runtime: Bun + SvelteKit + adapter-cloudflare on Workers (delete all Deno/Pi/OCI/nix content, including the whole "Nix module + hermetic build" and old "Deployment" sections).
  - Cache: parsed unfiltered tasks (`TaskCache`) in R2 (`task-burndown-cache/task-cache.json`, binding `CACHE`); base filters are client-side now.
  - Data flow: `GET /api/tasks` stream → client parses/filters; Today sync via `POST /api/refresh?since=` (returns `needsFull` when cache empty/stale); Full Sync = client chunk loop over `POST /api/refresh-chunk` + `PUT /api/cache`; why: free-tier 10 ms CPU / 50 subrequests (cite the spec).
  - Secrets: `.env.tpl` + `op run` locally, Worker secret via `just sync-secrets`, `getNotionApiKey(platform.env)`.
  - Testing: `deno test` → `bun run test` (vitest); drop the sloppy-imports note.
  - Deployment: `just deploy` / GHA `deploy.yml`; Access + PWA notes (Cloudflare IdP, 1-month session, manifest `use-credentials`).

- [ ] **Step 2: Rewrite `README.md`** — quickstart (`bun install`, `just dev`), `just setup` bootstrap, and the **manual steps** section (the only un-codifiable ops):
  1. Workers dashboard → `task-burndown` → Settings → Domains & Routes → workers.dev → **Enable Cloudflare Access**; then Zero Trust → Access → Applications → the auto-created app → set **Session Duration = 1 month** and confirm the policy is the Cloudflare identity provider restricted to Alex's account.
  2. 1Password (Alex runs; note the zsh quoting gotcha):
     ```bash
     op vault create "Task Burndown"
     op item move "Notion Task Burndown Chart Notion Internal Integration Secret" --current-vault Personal --destination-vault "Task Burndown"
     # CF creds for CI: create item "cloudflare" in "Task Burndown" with fields api-token, account-id
     op service-account create task-burndown-ci --vault "Task Burndown:read_items"
     ```
  3. GitHub repo secret `OP_SERVICE_ACCOUNT_TOKEN` = the new SA token.
  4. iPhone: open the site in Safari, sign in once, Share → Add to Home Screen.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md && git commit -m "docs: rewrite CLAUDE.md/README for Cloudflare stack"
```

---

### Task 12: Deploy + production smoke

**Files:** none (operations). Some steps are Alex-only (dashboard/1Password) — pause and hand him the exact commands/clicks rather than skipping.

- [ ] **Step 1: Verify wrangler auth** — `bunx wrangler whoami`. If not logged in, ask Alex to run `wrangler login` (or `! bunx wrangler login`).
- [ ] **Step 2: Bootstrap bucket + seed both R2s** — `just setup`. Expected: bucket created; two `put` successes.
- [ ] **Step 3: Deploy** — `just deploy`. Expected: tests pass, build passes, `Deployed task-burndown` with a `*.workers.dev` URL.
- [ ] **Step 4: Push the Worker secret** — Alex must be `op`-signed-in: `just sync-secrets`. Expected: `NOTION_API_KEY` uploaded.
- [ ] **Step 5: Alex — dashboard click-ops** (README manual step 1: enable Access on workers.dev, session duration 1 month, Cloudflare IdP policy).
- [ ] **Step 6: Prod smoke** — in a browser: Access login → chart renders from seeded cache; "Today" completes; "Full" loop completes (~15 chunks) and survives a reload. `just logs` while clicking to watch for 1102s (there should be none).
- [ ] **Step 7: Alex — iPhone install** (README manual step 4) — icon is the chart glyph, opens standalone, no re-login on second open.
- [ ] **Step 8: 1P vault/SA + GH secret** (README manual steps 2–3) so the GHA deploy works; then push to main and confirm the `deploy` workflow goes green.
- [ ] **Step 9: Final commit of any doc corrections discovered during smoke; done.**

---

## Post-plan notes

- The legacy `notion-cache.json` stays on disk (gitignored) as the seed source; it is dead weight after Step 12 and can be deleted whenever.
- Free-tier headroom: incremental refresh ≈ 5–8 ms CPU at 1.1 MB cache; if the cache doubles, revisit (spec Risks table).
