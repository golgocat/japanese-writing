import { readFileSync } from 'node:fs';

const configuration = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const production = configuration.env.production;
const origin = new URL(production.vars.APP_ORIGIN);
const kv = production.kv_namespaces.find(value => value.binding === 'OAUTH_KV');
const database = production.d1_databases.find(value => value.binding === 'AUTH_DB');
if (origin.protocol !== 'https:' || !/^[a-f0-9]{32}$/.test(kv?.id ?? '') || !/^[a-f0-9-]{36}$/.test(database?.database_id ?? '') || /^0+-0+-0+-0+-0+$/.test(database.database_id)) {
  throw new Error('Production has not been provisioned. Configure the approved origin, OAuth KV, and D1 database before deployment.');
}
console.log(`Deployment target: ${production.name}; MCP endpoint: ${origin.origin}/mcp`);
