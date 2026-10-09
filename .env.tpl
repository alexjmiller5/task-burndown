# Canonical secrets manifest - 1Password secret references only, SAFE to commit.
# Refs are BY NAME on purpose: op-project-bootstrap parses this file.
# Local dev:      op run --env-file=.env.tpl -- bun run dev
# Push to CF:     just sync-secrets
NOTION_API_KEY=op://Task Burndown/Task Burndown ENV/NOTION_API_KEY
SOMA_TASKS_CONFIG=op://Task Burndown/Task Burndown ENV/SOMA_TASKS_CONFIG
SOMA_HUB_URL=op://Task Burndown/Task Burndown ENV/SOMA_HUB_URL
SOMA_HUB_TOKEN=op://Task Burndown/Task Burndown ENV/SOMA_HUB_TOKEN
