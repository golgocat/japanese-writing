import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const references = ['business-personal', 'sensitive-messages', 'structured-writing', 'meeting-minutes', 'summaries-and-length', 'translation-and-bilingual', 'marketing-ux-creative', 'plain-japanese-boundaries', 'research-sources'];
const files = ['SKILL.md', ...references.map(name => `references/${name}.md`)];
const documents = Object.fromEntries(await Promise.all(files.map(async path => [path, await readFile(new URL(`../${path}`, root), 'utf8')])));
const version = `sha256:${createHash('sha256').update(JSON.stringify(documents)).digest('hex')}`;
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', root), encoding: 'utf8' }).trim();
const output = new URL('src/generated/skill.ts', root);
await mkdir(new URL('.', output), { recursive: true });
await writeFile(output, `// Generated from the public skill files; do not edit.\nexport const bundle = ${JSON.stringify({ id: 'japanese-writing', version, sourceCommit, documents }, null, 2)} as const;\n`);
console.log(`Bundled ${files.length} skill documents (${version.slice(0, 23)}).`);
