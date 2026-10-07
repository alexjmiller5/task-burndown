# Task Burndown

A SvelteKit app that visualizes Notion task data as interactive stacked area charts over time. Runs on Cloudflare Workers, cached in R2, protected by Cloudflare Access, installable as an iOS homescreen PWA.

## Requirements

- [Bun](https://bun.sh/)
- [1Password CLI](https://developer.1password.com/docs/cli/) (`op`)
- [wrangler](https://developers.cloudflare.com/workers/wrangler/) (installed via `bun install`)

## Quick Start

```bash
bun install
just dev        # dev server at http://localhost:5173, miniflare R2 for cache
```

Secrets are injected via `op run` — you'll need to be signed into 1Password CLI with access to the `Task Burndown` vault.

## Bootstrap (first time)

```bash
just setup      # creates R2 bucket + seeds local and prod cache from notion-cache.json
just deploy     # test + build + wrangler deploy
just sync-secrets  # push NOTION_API_KEY as a Worker secret
```

`notion-cache.json` (legacy raw-page cache) stays in the repo root as the seed source until the first deploy completes. After that it's unused.

For local deploys you'll also need either `bunx wrangler login` or a `CLOUDFLARE_API_TOKEN` environment variable.

## How It Works

- Fetches tasks from a Notion database via the Notion API
- Parses ~4,300 tasks → 1.1 MB `TaskCache` stored in R2 (`task-burndown-cache/task-cache.json`)
- Page load: `GET /api/tasks` streams the R2 object to the client (~0 Worker CPU); client applies filters and renders
- On mount: `POST /api/refresh` incrementally syncs everything edited since the last sync (cache high-water mark)
- Sync button: edits sync + deletion sweep — id-only queries (`POST /api/prune`) collect live page ids for tasks that could plausibly change (created/edited in the last 90 days, or To Do / In Progress); sweep-eligible cached tasks not in the set are dropped and the pruned cache is PUT back
- Empty cache bootstraps via a client-driven chunked loop (`POST /api/refresh-chunk`, ~15 requests, ~20–30 s) followed by `PUT /api/cache`
- Stacked area chart showing active task counts over time, grouped by tag, priority, or project
- Filtering by tags, due date status, legacy cutoff, and incomplete/project toggles

Completed or canceled tasks with no completion date are excluded from the chart
and its metrics, since their history cannot be dated. They remain in Notion and
the cache. Open tasks without a due date count from their creation date. Subtasks
count individually, so a Notion view hiding subtasks can show a smaller total.

## Secrets

`.env.tpl` holds op:// references (safe to commit). Local dev secrets are injected by `just dev` (`op run --env-file=.env.tpl -- bun run dev`). Production secret (`NOTION_API_KEY`) is pushed to the Worker via `just sync-secrets` or the GHA deploy workflow.

## Deployment

- **Local**: `just deploy` (runs tests, builds, deploys via wrangler)
- **CI/CD**: push to `main` → `.github/workflows/deploy.yml` (1P service account authenticates both CF API and Worker secret push)

## Manual Steps

The following cannot be codified and must be done once by hand:

### 1. Cloudflare Access (scripted, never the dashboard)

```bash
scripts/cf-access.py --name task-burndown \
  --domain task-burndown.<subdomain>.workers.dev \
  --domain '*-task-burndown.<subdomain>.workers.dev' \
  --email <you> --pwa
```

Idempotent (`--dry-run` previews). `--pwa` adds the bypass app for the
cookie-less icon/manifest paths so the iOS homescreen icon renders. The
workers.dev subdomain is account-level and has changed before - read it from
the deploy output, and re-run this after any change (an app pointing at the
old hostname protects nothing).

### 2. 1Password vault + service account

Run these (note: zsh may require quoting vault names with spaces):

```bash
op vault create "Task Burndown"
op item move "Task Burndown Notion Internal Integration Secret" --current-vault Personal --destination-vault "Task Burndown"
# CF creds for CI: create item "Task Burndown CI Cloudflare Token" in "Task Burndown" with fields api-token, account-id
op service-account create task-burndown-ci --vault "Task Burndown:read_items"
```

### 3. GitHub secret

Add `OP_SERVICE_ACCOUNT_TOKEN` as a repo secret (value = the SA token output from the `op service-account create` command above).

### 4. iPhone homescreen

Open the site in Safari, sign in once with your Cloudflare account, then Share → **Add to Home Screen**. The `CF_Authorization` cookie persists for ~1 month; subsequent launches open directly to the app.

## Offline use

Open the dashboard online once and let it finish loading. Later launches can use
its downloaded application and last successful data on that device. Saved data is
labelled with its save time. Reconnect loads through Cloudflare Access when your
connection returns or your sign-in needs renewing. Refresh waits for a fresh
response and keeps the previous chart if the request fails. Clearing the site's
browser data removes the offline copy; a first visit still needs internet access.

## Life Data reader

Set server-only `LIFE_TASKS_CONFIG` (JSON), `LIFE_HUB_URL` and a dedicated
`LIFE_HUB_TOKEN` to select Life Data. With no mapping, the Notion reader remains
selected. Malformed or incomplete Life configuration fails closed. The token
needs read access only to the configured task and project columns, including
`id`, `updated_at` and `deleted_at`. It is never returned to the browser.

The mapping contains `table`, `projects: {table, title}`, `tagColors` and
`columns` with these semantic keys: `created`, `completed`, `dueDate`, `status`,
`tags`, `priority`, `projectIds`, `aiCompleted`. Values are catalog column IDs;
`created` must identify the original creation timestamp. Tag colors are explicit
runtime preferences, preserving the source palette. Store these settings using
the deployment's normal secret/configuration interface, not in source code.

Life Data refreshes scan bounded pages using the service's opaque cursor. This
is a current scan, not a frozen snapshot or backup. The browser publishes the
replacement cache only after every page succeeds; failures preserve the last
complete cache. Tombstones remove prior page entries. A binding change or
repeated cursor aborts the scan. Sync covers all tasks, including old completed
and canceled records; the chart's existing filters still apply. Source dates and
missing completion dates are never inferred from import or synchronization time.
The first source-ordered project supplies the chart label; an unresolved linked
project remains linked and displays `(Unavailable Project)`.
