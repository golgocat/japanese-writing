import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const action = args[0];
const emailIndex = args.indexOf('--email');
const email = (emailIndex < 0 ? '' : args[emailIndex + 1] ?? '').trim().toLowerCase();
const remote = args.includes('--remote');
const allowedArgs = new Set([action, '--email', emailIndex >= 0 ? args[emailIndex + 1] : '', '--local', '--remote']);
if (!['invite', 'suspend', 'restore'].includes(action) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || args.some(value => !allowedArgs.has(value)) || (remote && args.includes('--local'))) {
  console.error('Usage: npm run member -- invite|suspend|restore --email person@example.com [--local|--remote]');
  process.exit(2);
}
const sqlEmail = `'${email.replaceAll("'", "''")}'`;
const now = Date.now();
const sql = action === 'invite'
  ? `INSERT INTO members(id, invited_email, role, status, skills_json, created_at, updated_at) VALUES ('${crypto.randomUUID()}', ${sqlEmail}, 'member', 'active', '["japanese-writing"]', ${now}, ${now}) ON CONFLICT(invited_email) DO NOTHING;`
  : `UPDATE members SET status = '${action === 'suspend' ? 'suspended' : 'active'}', updated_at = ${now} WHERE invited_email = ${sqlEmail};`;
const directory = mkdtempSync(join(tmpdir(), 'japanese-writing-members-'));
const file = join(directory, 'operation.sql');
try {
  writeFileSync(file, sql, { mode: 0o600 });
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'AUTH_DB', remote ? '--remote' : '--local', '--env', remote ? 'production' : '', '--file', file], {
    cwd: new URL('../', import.meta.url), stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} finally { unlinkSync(file); rmdirSync(directory); }
