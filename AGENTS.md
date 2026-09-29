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

`/mcp` requires sign-in. `/authorize` asks for an email, sends a code only when that email is already in the allowlist, and does not say whether the address was found. The list is the KV key `emails` in the `ALLOWLIST` binding. It is a JSON array. Do not commit addresses.

```bash
npm run allow-email -- person@example.com
```

Secret names, values stay in Cloudflare: `SIGN_IN_PEPPER`, `AGENTMAIL_API_KEY`, `AGENTMAIL_INBOX_ID`.

```bash
npm run dry-run
npx wrangler deploy --env production
```
