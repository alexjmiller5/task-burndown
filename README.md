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

## Secrets

`.env.tpl` holds op:// references (safe to commit). Local dev secrets are injected by `just dev` (`op run --env-file=.env.tpl -- bun run dev`). Production secret (`NOTION_API_KEY`) is pushed to the Worker via `just sync-secrets` or the GHA deploy workflow.

## Deployment

- **Local**: `just deploy` (runs tests, builds, deploys via wrangler)
- **CI/CD**: push to `main` → `.github/workflows/deploy.yml` (1P service account authenticates both CF API and Worker secret push)

## Manual Steps

The following cannot be codified and must be done once by hand:

### 1. Enable Cloudflare Access

Workers dashboard → `task-burndown` → Settings → Domains & Routes → workers.dev → **Enable Cloudflare Access**.

Then: Zero Trust → Access → Applications → the auto-created app → set **Session Duration = 1 month** and confirm the policy uses the Cloudflare identity provider restricted to Alex's account.

Finally, add a second Access application ("public PWA assets") with a **Bypass / Everyone** policy covering exactly these paths — iOS fetches the homescreen icon and browsers fetch the manifest **without cookies**, so without this the icon falls back to a letter monogram:

```
task-burndown.amiller06880.workers.dev/apple-touch-icon.png
task-burndown.amiller06880.workers.dev/icon-192.png
task-burndown.amiller06880.workers.dev/icon-512.png
task-burndown.amiller06880.workers.dev/favicon.svg
task-burndown.amiller06880.workers.dev/manifest.webmanifest
```

(These are three chart PNGs and an app name — nothing sensitive. Everything else stays behind Access.)

### 2. 1Password vault + service account

Run these (note: zsh may require quoting vault names with spaces):

```bash
op vault create "Task Burndown"
op item move "Notion Task Burndown Chart Notion Internal Integration Secret" --current-vault Personal --destination-vault "Task Burndown"
# CF creds for CI: create item "cloudflare" in "Task Burndown" with fields api-token, account-id
op service-account create task-burndown-ci --vault "Task Burndown:read_items"
```

### 3. GitHub secret

Add `OP_SERVICE_ACCOUNT_TOKEN` as a repo secret (value = the SA token output from the `op service-account create` command above).

### 4. iPhone homescreen

Open the site in Safari, sign in once with your Cloudflare account, then Share → **Add to Home Screen**. The `CF_Authorization` cookie persists for ~1 month; subsequent launches open directly to the app.
