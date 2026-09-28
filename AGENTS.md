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

Do not deploy unless the task names the target. Production and staging are the named environments. No secrets are declared.
