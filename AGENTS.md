# Japanese Writing

Keep `SKILL.md` and `references/` as the source of writing guidance. The MCP adapter lives in `mcp/` and bundles these files at build time. Never copy private installed-skill references into this public repository.

## Validation

- Skill counter: `node --test scripts/count_characters.test.mjs`
- MCP dependencies: `npm ci --prefix mcp`
- MCP checks: `npm run check --prefix mcp`
- Worker build: `npm run build --prefix mcp`
- Local server: `npm run dev --prefix mcp`

OAuth changes require rejection tests and a complete local authorization-to-MCP flow. Mock Google responses do not prove real Google authentication. Keep Google tokens, client secrets, allowlisted addresses, and user drafts out of git and logs.

## Deployment

`npm run deploy --prefix mcp` requires explicit approval for the target environment and prepared credentials. Do not enable automatic deployments. Do not reuse Google Workspace desktop OAuth credentials. Production redirects and the public origin must match exactly.
