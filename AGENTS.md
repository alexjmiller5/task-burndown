# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Project Overview

Task Burndown is a SvelteKit web application that visualizes task data (Soma, or Notion) as a stacked bar chart over time. It runs on Cloudflare Workers with cache in R2, protected by Cloudflare Access, and is installable as an iOS homescreen PWA.

## Running the App

```bash
just dev     # SvelteKit dev server on port 5173 (secrets injected via op run)
just test    # Run unit tests (vitest)
just check   # All static analysis: wrangler types + svelte-check + prettier
just deploy  # test + build + wrangler deploy
```

Requirements: Bun, 1Password CLI (`op`), wrangler (via Bun).

## Architecture

### Runtime & Framework

- **Bun** as the JavaScript/TypeScript runtime and package manager
- **SvelteKit** (Svelte 5 with runes) + **`@sveltejs/adapter-cloudflare`** — deployed as a Cloudflare Worker
- **Vite** config only (`vite.config.ts`); no `svelte.config.js`
- **Chart.js** for chart rendering (loaded client-side via dynamic import)
- **Tailwind CSS v4** via `@tailwindcss/vite` plugin
- **shadcn-svelte** (Bits UI) for interactive controls - owned components under `src/lib/components/ui/` (`select`, `button`, `separator`, `dialog`, `input`), config in `components.json`, `cn()` in `src/lib/utils.ts`. Tokens are mapped to the app palette inside `app.css`'s `@theme`; `--color-muted` stays the legacy TEXT color, so the ui components' `bg-muted` surfaces are patched to `bg-secondary` (re-adding a component with `--overwrite` also rewrites `button`: restore it with `git checkout`). Dark-only: `class="dark"` on `<html>` + `@custom-variant dark`. A global rule gives all non-disabled buttons `cursor: pointer`; `tw-animate-css` provides the components' open/close animations. Select popovers min-width-match their trigger (`--bits-select-anchor-width`) and cap their height at the space available (`--bits-select-content-available-height`), scrolling long lists. Component-internal Lucide icons stay as-is (icons skill); control triggers use inline heroicons
- **dayjs** for date manipulation in `src/lib/data/filters.ts`. All other date math is in `src/lib/data/timezone.ts` using `Intl.DateTimeFormat` for IANA timezone conversion (no dayjs plugins needed).

### Cache — R2

- Bucket: `task-burndown-cache`; binding: `CACHE` (wrangler.jsonc IaC).
- Object: `task-cache.json`; shape: `TaskCache` = `ParsedData & { lastFullRefreshAt: string | null }`, where `ParsedData = { tasks: Task[], allTags, allPriorities, allProjects, tagColors }`.
- Stores **parsed, unfiltered tasks** (~4,300 tasks, ~1.1 MB). Raw Notion pages (~16.9 MB, ~78 ms CPU to parse) exceed the Workers free-tier 10 ms CPU cap, so parsing is done once during Full Sync and the result is cached.
- Local dev: miniflare R2 via the SvelteKit platform proxy, state persisted under `.wrangler/state/`.
- One-time bootstrap: `just setup` (creates bucket, seeds local and prod via `scripts/seed-cache.ts` from legacy `notion-cache.json`).

### Server Modules (`src/lib/server/`)

- `secrets.ts` — `getNotionApiKey(env)`: reads `platform.env.NOTION_API_KEY` (Worker secret); falls back to `process.env.NOTION_API_KEY` (injected by `op run` in dev).
- `cache.ts` — R2 `bucket.get` / `bucket.put`; functions take the `R2Bucket` binding as a parameter. `readCache` returns `EMPTY_CACHE` on miss. No legacy migration.
- `notion.ts` — Notion API client with full and incremental fetch modes; `fetchPageChunk` for the chunked full-sync loop (3 Notion pages per request ≈ 4–6 ms CPU, 3 subrequests); `fetchIdChunk` for the deletion sweep (`filter_properties[]=title` keeps responses ~50 KB, so 10 API pages ≈ 1,000 ids per request).

### Data Processing (`src/lib/data/`)

Pure TypeScript modules shared between server and client:

- `parser.ts` — `parseTasks(pages): ParsedData` parses Notion pages into **unfiltered** Task objects + metadata. No filtering; callers call `applyBaseFilters` themselves.
- `merge.ts` — `mergeParsedData` (id-keyed merge of incremental result into cached tasks); `getIncrementalSince` (threshold = earlier of `max(created)` and `max(lastEditedTime)` across cached tasks).
- `filters.ts` - `applyBaseFilters` (canceled unless the Canceled chip toggles them in; completed/canceled tasks without a completion date cannot be charted) and `applyViewFilters` (legacy cutoff 2025-01-10, then the Projects lens: `projectKinds` with/without project).
- `timezone.ts` - `toLocalDateStr`, `addDays` (DST-safe via UTC arithmetic), `getCurrentDateStr`, the curated `TIMEZONES` list and `DEVICE_TIMEZONE` (the `'device'` picker value the page resolves at run time). Date functions take a `DayZone`: an IANA zone (days start at midnight) or `{ tz, dayStart }` (see Day boundary).
- `presets.ts` — `getPresetRange(label, tz)` for the date-range preset buttons (7D/30D/90D/1Y/MTD/YTD/ALL).
- `events.ts` - Builds events Map keyed by date with created/completed/stateChange arrays. Takes a `DayZone` so `created_time` (UTC ISO) buckets to the user's selected zone and day start.
- `calculator.ts` - Day-by-day running count calculation, O(days × tasks). Uses `addDays` from `timezone.ts` (DST-safe). Owns `getTaskStartDate`, the single anchor every view uses (see Key Concepts). Also owns the age bands (`AGE_BAND_LIMITS` 7/30/90/180 days, `AGE_BAND_ORDER` oldest-first) used by the `age` group-by, `AI_ORDER` for the `ai` group-by (AI Completed / Manual, from the Notion `AI Completed` checkbox), `STATUS_ORDER` for the `status` group-by (To Do, In Progress, Completed, Canceled; any other status follows alphabetically, a blank one is `(No Status)`) and `getCategories`, each group-by's categories in display order (see Categories come from the data); `events.ts` emits band-crossing `stateChange` events so a task migrates bands on days with no edits.
- `metrics.ts` — `tasksInWindow` (open at any point in a date window) and `tasksResolvedIn` (completed/canceled inside it) feed the header stats, which follow the slider window: active = open count on the window's last day (labelled `active <date>` when that day is in the past), tracked/tags/with projects count `tasksInWindow`, due → done and canceled % use `tasksResolvedIn`. `calculateDailyMetrics` (per-day avg open-task age, p90 open-task age, rolling 14-day median age-at-completion) and `calculateCompletions` (per day/week/month bucket: backlog vs same-day completions plus `added` — effective starts that joined the open pile, same-day excluded); also exports `bucketLabel` so the chart can align completion rows with downsampled points.

### Server Routes (`src/routes/`)

No `+page.server.ts` — chart is client-only; page has no SSR data load.

- `GET /api/tasks` — streams the R2 object body straight through (`new Response(obj.body)`, ~0 CPU); client parses + applies filters.
- `POST /api/refresh` — incremental sync (Soma: see Optional Soma source). Notion: reads cache (~2.5 ms parse), fetches everything edited since the cache's own high-water mark (`getIncrementalSince` = earlier of max(created)/max(lastEditedTime)), merges tasks by id, writes cache back (~2.3 ms stringify). Self-healing: catches edits from days the app was never opened. Returns `{ needsFull: true }` only when the cache is empty; `{ needsFull: false, freshCount, lastFullRefreshAt }` otherwise.
- `POST /api/prune?cutoff=<iso>&cursor=<cursor>` — one step of the deletion sweep: returns `{ ids, nextCursor }`, up to ~1,000 live page ids per call (id-only queries). Heuristic: only sweeps tasks that could plausibly change — created/edited since the cutoff (90 days) or status To Do / In Progress (~1,250 ids, 2 calls, vs 4,300 in 5). Client loops until `nextCursor` is null, then drops sweep-eligible cached tasks missing from the swept id set and PUTs the pruned cache. Client computes the cutoff once and both sides use it, so the eligibility predicates can't disagree.
- `POST /api/refresh-chunk?cursor=<cursor>` — one step of the chunked Full Sync loop. Fetches up to 3 Notion API pages (~3 subrequests, ~4–6 ms CPU), returns `{ tasks, tagColors, …, nextCursor }`. Client accumulates chunks until `nextCursor` is null.
- `GET`/`PUT /api/markers` — the user's event markers: one `markers.json` object in the same R2 bucket, replaced wholesale and validated by `parseMarkers` (`src/lib/markers.ts`: ISO dates, 1-80 char label, up/down/flat, a flat band needs an end on or after its date; sorted by date). Markers are user data - edited in `MarkerEditor.svelte` (the pencil button beside the Markers chip, a shadcn Dialog), never as literals in code.
- `GET`/`PUT /api/settings` - settings every device shares: one `settings.json` object in the same R2 bucket, replaced wholesale and validated by `parseSettings` (`src/lib/settings.ts`). Today it holds `dayStartMinutes` (integer 0-1439, default 0 = midnight); a missing object serves the default, an invalid PUT is a 400. The page loads it through `readDashboard` and PUTs it from the Day starts at select.
- `PUT /api/cache` — client streams the assembled `TaskCache` JSON into R2 after completing the chunk loop. Cheap sanity check only (non-empty, starts with `{`); CF Access restricts callers.

### Data Flow

1. **Page load**: client `onMount` → `GET /api/tasks` → streams 1.1 MB JSON → client parses, applies `applyBaseFilters` + view filters → renders chart.
2. **Edits sync** (on mount and via the "Edits" button): `POST /api/refresh` — server syncs from the cache high-water mark, so this catches all edits since the last sync. If `needsFull: true` (empty cache) → falls into Full Sync bootstrap.
3. **Sync button** (`pruneSync`): Soma: `POST /api/refresh?full=1` (re-read every row; no sweep, the response says `pruned`). Notion: edits sync + deletion sweep — `POST /api/refresh`, `GET /api/tasks`, loop `POST /api/prune` (~5 calls) to collect live ids, drop cached tasks not in the set, `PUT /api/cache`. Guard: aborts rather than PUT if the sweep returns zero ids.
4. **Full Sync** (bootstrap only, when `needsFull`): client loops `POST /api/refresh-chunk` (~15 sequential requests, ~20–30 s, "Sync N" progress) until `nextCursor` is null, assembles `TaskCache`, then `PUT /api/cache`.
5. Client updates chart reactively via Svelte 5 `$derived` pipeline.

**Why chunked full sync?** Workers free tier: 10 ms CPU/request + 50 subrequests/request. Parsing 16.9 MB of raw pages costs ~78 ms CPU. Storing parsed tasks (1.1 MB) and chunking the full refresh through the browser stays within both limits.

### Components (`src/components/`)

- `TaskChart.svelte` - Chart.js stacked bar chart (client-only via dynamic import); `tagColors` values may be Notion color names or `#hex` (the age-band ramp). A category with nothing open in the visible window stays out of the datasets and legend; fallback colors index the full category list, so they never shift with the window. The `eventMarkers` plugin draws the user's markers (loaded from `/api/markers`) on the burndown's good/bad axis - 'up' (backlog grew) red, 'down' (purge) the same green `AI Completed` uses for done, 'flat' neutral slate; both are light-400 shades so they stay visible over the dark `1-3m` crimson band. Labels sit inside the plot in headroom opened above the tallest bar: the plugin lays them out, then solves `y.max = dataMax × H / (H − needed)` (rounded to a clean tick) so the data tops out just below the label block, re-fitting on zoom/range and capped at 3 relayouts per chart instance. It draws in two passes - lay out every label, then draw the rules - so each rule can run from its own label down to the axis, broken around any lower label it would otherwise strike through. The plugin itself is `createMarkerPlugin` in `src/lib/markers.ts` (shared with RateChart; parameterized by marker list + the y-value labels must clear, `reset()` on rebuild); `assignLane` (unit-tested) drops each label into the highest free horizontal lane
- `RateChart.svelte` — the burndown's rate of change, shown when the chart-mode select is on Rate: added (effective starts that joined the pile) up in the marker red, backlog completions down in the marker green, bucket-aware; tooltip footer shows the net; the Markers chip draws the shared event markers here too. The Same-day chip inserts same-day churn ONCE as a hatched block straddling the zero line, pushing both solid bars outward by the same half-height — so top-end vs bottom-end still reads the exact net and the churn visibly touches neither flow. All three series are floating [base, end] bars with `grouped: false` (one shared column, no stacking arithmetic); the same-day dataset stays out of the legend (the chip is its toggle, since a legend toggle couldn't re-base the other bars) and tooltip values are read off the completions row, not `raw`
- The same-day cap lives inside `TaskChart`: a full-width diagonal-hatched muted-slate segment stacked on top of each bar at true 1:1 scale — same-day tasks (created and completed the same day) net zero open so the burndown can't otherwise show they existed. Toggled by the Same-day chip (`showCompleted` pref); excluded from the legend and tooltip body (so Total stays = open tasks); `capTop` feeds the marker plugin's headroom math. A legend click records the toggle then rebuilds the whole chart (rAF-deferred) so the 14d avg follows visible categories. The tooltip footer always shows "Added: K" (Δ backlog = added − backlog completions) "Completed: N" and "Same-day: M", each on its own line, when the bucket has activity
- `src/lib/colors.ts` - series-color resolution for the bar charts: the ten palette names (Soma catalog option colors, the Notion palette) as solid fills validated for the dark chart surface (every pair distinct in normal vision and under protan/deutan simulation, each at least 3:1 against the surface; re-run the dataviz validator before changing one), `#hex` ramps, and the index fallback. TaskChart's `avgHalo` plugin draws a surface-colored halo under the gold 14d avg line so it stays legible over yellow fills
- `src/lib/legend.ts` — legend-toggle memory for TaskChart (unit-tested). The chart is destroyed and rebuilt on every prop change, so hidden dataset labels live here: each group-by keeps its own hidden set, persisted to localStorage (`burndown:legend:v1`), so toggles survive range/data/bucket changes, breakdown switches, and page reloads. `hiddenByDefault` (e.g. "(No Project)") seeds only a group's first-ever visit; `14d avg` carries its current state across group switches within a session. The 14d avg is computed inside TaskChart (`rollingAvgTotals` over the full daily series via `avgSource`, summing only legend-visible categories) and recalculates on legend clicks
- `RangeSlider.svelte` - Dual-handle date range over the whole slider span (`SLIDER_MIN` to today): drag either handle, drag the filled span to slide the window, click the track to jump the nearest handle. Handles grow and glow on hover/drag and get bigger targets on touch (`pointer: coarse`). Keyboard: arrows move a focused handle a day, Page Up/Down a week, Home/End to its limit. Date math is UTC (`addDays`).

UI controls are inlined in `src/routes/+page.svelte` rather than extracted into components. Every selector is a shadcn Select (icon + mono-uppercase trigger, dark popover), the same control on every viewport: range preset, group-by, Active/Rate chart mode, time bucket (Day/Week/Month - the burndown downsamples to the last day of each bucket, the rate view and same-day cap aggregate per bucket), timezone ("This device (<zone>)" first, then the curated zones; phones show "Device"), Day starts at (whole hours 00:00-23:00, sun icon; phones show only the time), the **Projects lens** (`Select type="multiple"` of with/without project, lit in the chip-on style while narrowing, hidden under the project group-by; picking nothing snaps back to both), plus the Canceled/Same-day/Markers filter chips - all on the left; the right side holds only the Edits and Sync buttons. Chips, lens, chart mode and time bucket are persisted with the other prefs (`preferences.ts`, key `burndown:prefs:v1`). Each saved field is validated independently; unavailable storage does not interrupt use. Relative presets are recomputed and Custom dates remain literal. Priority legend/tooltip order follows `PRIORITY_ORDER` (High → Low), not alphabetical. The header shows only a "Sync failed" indicator on error - no live/syncing badge.

## Secrets

- `.env.tpl` - canonical secrets manifest (op:// references, safe to commit). The owning ENV item supplies `NOTION_API_KEY`, `SOMA_TASKS_CONFIG`, `SOMA_HUB_URL` and `SOMA_HUB_TOKEN`.
- Local dev: `just dev` = `op run --env-file=.env.tpl -- bun run dev`.
- Production: `just sync-secrets` (or the GHA deploy workflow) runs `scripts/sync-secrets.sh` to push Worker secrets via `wrangler secret put`.
- 1Password vault: `Task Burndown`; service account: `task-burndown-ci` (read-only to that vault); SA token = repo GH secret `OP_SERVICE_ACCOUNT_TOKEN`.

## Deployment

- `just deploy` — `bun run test && bun run build && bunx wrangler deploy`.
- `just logs` — `bunx wrangler tail`.
- `just sync-secrets` — push Worker secrets from `.env.tpl` via `scripts/sync-secrets.sh`.
- GHA: `.github/workflows/deploy.yml` triggers on push to `main`; uses 1P service account for both Cloudflare credentials and Worker secrets.
- One-time `bunx wrangler login` (or `CLOUDFLARE_API_TOKEN` env var) needed before the first local deploy.

## Access & PWA

- **Cloudflare Access**: enabled on the `workers.dev` domain via the Workers dashboard toggle. Policy: Cloudflare identity provider restricted to Alex's account. App session duration: 1 month. _(Manual setup — see README.)_
- **PWA manifest**: `static/manifest.webmanifest` — name "Task Burndown" / short_name "Burndown", `display: standalone`, theme/background `#030304`, 192/512 PNG icons. Linked in `app.html` with `crossorigin="use-credentials"` — browsers fetch manifests credentialless by default, and Access blocks cookie-less requests.
- **apple-touch-icon**: `static/apple-touch-icon.png` (180×180); `<link rel="apple-touch-icon">` in `app.html`.
- **Icons**: generated by `scripts/generate-icons.ts` (heroicons chart-bar, `#F7931A` (bitcoin orange) on #030304 rounded background); PNGs committed.
- **iOS homescreen**: standalone PWAs have an isolated cookie jar → one sign-in on first launch, then ~monthly re-auth.

## Testing

Tests live next to the modules they cover (`*.test.ts`) and run via `bun run test` (vitest).

Coverage focuses on pure TS modules in `src/lib/data/` and `src/lib/server/` - the places where actual logic lives. Svelte component tests are intentionally not wired up. `bun scripts/test-date-preferences.mjs <target-id> <local-origin> [cdp-port]` exercises the rendered controls in an explicitly owned browser target with synthetic API responses: reload persistence, ALL, keyboard, Home/End, span drags, and 390px layout. It also covers the "This device" default (under an emulated `Asia/Tokyo` zone), the one-time discard of a version 1 timezone, and the Day starts at control against a synthetic `/api/settings` at desktop and 390px widths. It requires a running dev server and a CDP browser (a throwaway headless Chrome works; agent Chrome tabs can report hidden and drop trusted clicks), and rejects non-local origins. Set `BURNDOWN_SCREENSHOT=<path>.png` to capture the mobile result there, plus `<path>-desktop.png` and `<path>-open.png` (the day start list open on a phone).

## Key Concepts

**Incremental fetching**: Instead of fetching all ~4,300 tasks, the refresh uses the earlier of `max(created)` and `max(lastEditedTime)` across cached tasks as a threshold, then queries Notion with `last_edited_time >= threshold`. Fresh tasks are merged by ID into the cache. This threshold is only sound if the cache actually contains every edit up to its own maximum — a full sync establishes that invariant and each incremental preserves it. (A historical bug synced from `start of today` instead, silently skipping edits from unopened days; a poisoned cache like that can only be repaired by a full sync.)

**Deletions are invisible to incremental fetch**: Notion's data source query API (version `2026-03-11`) silently excludes trashed/archived pages. The `/api/prune` id sweep handles this cheaply: fetch live page ids (slim `filter_properties[]=title` queries) for tasks that could plausibly change, drop sweep-eligible cached tasks not in the set. Accepted tradeoff: deleting an old, settled, non-open task won't be noticed until a full sync — such tasks are assumed immutable. The Sync button runs edits sync + sweep; the full re-parse loop is only needed to bootstrap an empty cache.

**Effective start date**: `getTaskStartDate` (`calculator.ts`) is the one date every view anchors on — due date when set, else created, and clamped back to the completion day if the task was finished before it. Due-over-created is what makes backfilled tasks honest: entering a task months late shouldn't make a months-old obligation look new. The clamp covers deferred tasks knocked out early (~3% of completions), which used to be dropped from the chart entirely — they now open and close on the same day, netting zero open but still counting as a completion. `buildEventsMap` (start + band crossings), `getAgeBand`, and `calculateCompletions` all use it, so the burndown, the age bands and the completion overlay can't disagree about when a task began.

**Timezone awareness**: The timezone picker defaults to "This device", stored as `'device'` and resolved per device from `Intl.DateTimeFormat().resolvedOptions().timeZone`; the curated fixed zones are alternatives. The choice is device-local (localStorage via `preferences.ts`, `version: 2`, along with groupBy, toggles, and preset; presets re-anchor to today on restore). A `version: 1` record keeps every field except its timezone, which predates "This device" and falls back to it. The page combines the zone with the shared day start into one `DayZone` and passes it to every date computation: `created_time` → date bucketing, range presets ("today" anchor), the slider's right edge, `totalActive`, and the marker editor's today. Date-only strings (`dueDate`, `completed`) pass through unchanged. A floating local due time (`YYYY-MM-DDTHH:MM`, no zone) keeps its own wall-clock date in every zone, moved to the previous date when earlier than the day start, so a timed task counts on its logical day and is not late before that day ends.

**Day boundary**: `dayStartMinutes` (from `/api/settings`, shared by every device) sets when a day begins, matching task apps that keep a 2 AM task on the previous day. While the wall clock in the zone is earlier than it, "today" is the previous date, and timestamps bucket the same way. `timezone.ts` reads the wall-clock hour and minute with `formatToParts` and steps back a day with `addDays`, so DST transitions need no special case; a zero day start keeps the faster date-only `format`.

**DST safety**: `addDays` in `timezone.ts` uses `Date.UTC` + `setUTCDate` so calendar-day arithmetic never lands on the wrong day across DST transitions, regardless of host TZ.

**View filters**: Base filters (canceled, closed without a completion date) apply client-side via `applyBaseFilters` after loading the cache. Toggle filters (legacy cutoff 2025-01-10, incomplete tasks, project tasks) apply client-side for instant response.

**Categories come from the data**: every group-by counts every value the data holds (`getCategories`): each tag in `allTags` (including `(Untagged)`), each status, priority, project, age band and AI state. The repo holds no tag names; tags and their colors are runtime data (under Soma, the catalog option colors of the tags column; see Optional Soma source), so a new tag counts in Active the day it appears, and Active is the same number under every group-by. Legend clicks hide series on that device (`legend.ts`) without changing the counts. The Status group-by keys each task by its current status, so past bars show what became of that day's open tasks; its colors follow the source palette (To Do red, In Progress blue, Completed green, Canceled gray).

**Missing completion dates**: Completed and canceled tasks without a completion
date stay in the unfiltered cache but are excluded from all chart series and
header metrics. Their status proves they are closed, but their history cannot be
placed accurately. Never substitute their last edit or creation time for a
completion date. Open tasks without a due date still count from their creation.

## Code Conventions

- TypeScript throughout, Svelte 5 runes (`$state`, `$derived`, `$effect`)
- Cloudflare Workers APIs for server modules; pure functions in `src/lib/data/` — no side effects, no DOM, no platform APIs
- Tailwind CSS utility classes for styling
- Heroicons (inline SVG, sourced from `/Users/alexmiller/desktop/coding/reference-repos/heroicons`) for all icons; never emojis
- `wrangler.jsonc` is the IaC; worker name `task-burndown`, R2 bucket `task-burndown-cache`

## Cloudflare credential boundaries

- `scripts/provision.py` mints a fresh, dedicated CI token with only Workers
  Scripts Write on the selected account. Set `CLOUDFLARE_ACCOUNT_ID` when
  the provisioning identity can see multiple accounts. Cloudflare enforces
  this permission at account scope, not per Worker.
- The CI token deploys this Worker and its existing bindings and secrets.
  Runtime data access uses Worker bindings or service credentials; CI has
  no direct D1, R2, DNS, email-routing, or Access administration permission.
- Provisioning credentials stay with the operator. Mint, save to the
  project CI item in 1Password, deploy, and verify before retiring the
  previous token by provider ID. Minting never deletes a working token.
- Check provisioning without credentials with
  `uv run --with httpx python scripts/test_cloudflare_provision.py`.

## Offline startup

- The production service worker caches the home document and bundled assets per
  build. A new build's worker skips waiting and `app.html` reloads an already
  controlled page once on `controllerchange`, so a deploy shows on the next open
  or reload; activation prunes only old shell caches. Never intercept API mutations or Cloudflare Access routes.
- `readDashboard` stores successful JSON GETs in device-local CacheStorage. Offline
  reads use the saved snapshot immediately; weak connections get 750 ms before
  fallback, with an 8-second request bound. Explicit refreshes require fresh data.
  Saved snapshots show their save time. Errors, redirects, and login HTML cannot
  replace a successful snapshot. Clearing website data removes offline data.
- Reconnect uses a full `/?online=1` navigation, bypassing the cached document so
  Cloudflare Access can authenticate. The flag is removed after startup. An online
  visit must finish loading once before offline reopening is possible.
- Run the offline helper and service-worker regression tests with the normal test
  suite; verify the production build with browser networking disabled, not Vite dev
  (SvelteKit only registers the service worker in production).

## Optional Soma source

`src/lib/server/soma.ts` validates the runtime `SOMA_TASKS_CONFIG` mapping
and reads only its configured columns through the supported hub API using the
app's own read credential, enrolled with the Soma profile
`task-burndown-reader-v1` (projected task and project columns only). The Worker
reaches the hub through the `SOMA_HUB` service binding (wrangler.jsonc `services`):
Cloudflare blocks a Worker's network fetch to a sibling workers.dev Worker (error
1042). The binding is transport only; auth stays the app's own token, and requests
use `redirect: 'manual'` because Workers reject `'error'`. No backing
infrastructure access or user schema
literals belong here. Without the mapping or with JSON `null`, routes keep using Notion.
In local dev (`import.meta.env.DEV`) `hubFetch` uses the network: the dev
platform proxy declares the `SOMA_HUB` binding with no hub Worker behind it.
Tag colors come from the catalog, not the mapping: whenever a sync writes the
cache (a non-quiet refresh or any chunk), `fetchTagColors` posts
`/v1/catalog/projection` for the tags column and keeps each option's palette
`color`, so the bars match the colors other Soma clients render. That needs the
profile grant `catalog:read:<table>:<tags column>` beside the column read; on a
403 or any failure the sync still lands and tags take the fallback colors. A
quiet refresh does not re-read colors, so a recolor shows with the next task
change or Sync.
Soma refresh is incremental (`refreshSoma`): Soma's table-pull helper
(`src/lib/server/table-pull.js`, vendored verbatim from soma
`core/src/table-pull.js`; refresh by copying it again) asks `/v1/cursor` once,
and a quiet round ends there with no R2 write. Otherwise it pulls tasks and
projects `since` the held marks in one batched request and patches the R2
cache. R2 `soma-pull.json` holds the cursor, project labels, each task's first
project ref (so renames and project tombstones relabel tasks) and the etag of
the cache object it was applied to: a cache replaced any other way (a chunked
full sync, a reseed), a changed mapping or `?full=1` (the Sync button) re-reads
every row in one invocation. `/api/refresh` answers `pruned: true`, since
tombstones arrive with the cursor. The cursor needs the profile to grant
`hub_at` on both tables (`tables:read:tasks:hub_at`,
`tables:read:projects:hub_at`); without it the cursor answers 403 and
`/api/refresh` returns `needsFull`, so the client runs the bounded chunked read
(`/api/refresh-chunk`): each chunk is one batched hub read (`{batch:[...]}`,
5,000 rows a request), every project plus up to 4,000 tasks; the hub may answer
a prefix past its byte budget, and the project walk or task page then follows
on its own. `src/lib/data/full-sync.ts`
owns all-pages-before-publication, later-page tombstone removal, binding identity
and cursor guards. An old deletion-sweep client receives 409 under Soma and
must refresh. Task dates retain source precision and null completion dates; project
membership is determined by refs even when its first label cannot resolve.
