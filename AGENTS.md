# japanese-writing

Cursor skill for Japanese writing, plus a remote MCP that lets another agent's model check 対訳 accuracy.

## Skill

```bash
node --test scripts/count_characters.test.mjs
```

The procedure lives in `SKILL.md` and `references/`. The accuracy rubric the MCP returns is a checklist. The full rules stay in `references/translation-and-bilingual.md`.

## MCP

Cloudflare Worker. Stateless Streamable HTTP at `/mcp`. Wrangler config is `wrangler.jsonc`.

```bash
npm test
npm run check
npm run dev
npm run dry-run
```

`align_for_review` segments a source, or pairs it with a translation. It does not call a model. The caller's agent writes the verdict from prompt `check_translation_accuracy`.

`/mcp` requires the OAuth bearer token. `/authorize` accepts the person already signed in with Cloudflare Access. It checks the Access JWT and the allowlist. It does not send a second email code. The allowlist is the KV key `emails` in the `ALLOWLIST` binding. It is a JSON array. Do not commit addresses.

```bash
npm run allow-email -- person@example.com
```

Production vars to set before the next deploy, not secrets: `ACCESS_TEAM_DOMAIN` (`https://<team>.cloudflareaccess.com`) and `ACCESS_POLICY_AUD` (the Japanese writing MCP application audience tag). Do not delete the existing `SIGN_IN_PEPPER` secret as part of this change. The Worker no longer reads it.

```bash
npm run dry-run
npx wrangler deploy --env production
```
