# Canonical secrets manifest - 1Password secret references only, SAFE to commit.
# Refs are BY NAME on purpose: op-project-bootstrap parses this file.
# Local dev:      op run --env-file=.env.tpl -- bun run dev
# Push to CF:     just sync-secrets
NOTION_API_KEY=op://Task Burndown/Task Burndown ENV/NOTION_API_KEY
LIFE_TASKS_CONFIG=op://Task Burndown/Task Burndown ENV/LIFE_TASKS_CONFIG
LIFE_HUB_URL=op://Task Burndown/Task Burndown ENV/LIFE_HUB_URL
LIFE_HUB_TOKEN=op://Task Burndown/Task Burndown ENV/LIFE_HUB_TOKEN
