# Canonical secrets manifest — 1Password secret references only, SAFE to commit.
# IDs, not names (vault "Notion Task Burndown Chart" / item "Notion Task Burndown Chart
# Notion Internal Integration Secret") — names are free to change, IDs aren't.
# Local dev:      op run --env-file=.env.tpl -- bun run dev
# Push to CF:     just sync-secrets
NOTION_API_KEY=op://gvrp4y4i42c3j2khqbuijf4lxm/55scwgetih3js2mpsah765skx4/credential
