import { SELF, env as testEnv, applyD1Migrations, reset } from 'cloudflare:test';
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Env } from '../src/types';
import type { D1Migration } from '@cloudflare/vitest-plugin';

const env = testEnv as Env & { TEST_MIGRATIONS: D1Migration[] };
const origin = 'https://mcp.example.test';
const redirectUri = 'https://client.example.test/callback';
let signingKey: CryptoKey;
let jwk: Record<string, unknown>;
let idToken = '';
let upstreamTokenCalls = 0;
let expectedGoogleChallenge = '';

async function challenge(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    if (url === 'https://oauth2.googleapis.com/token') {
      upstreamTokenCalls++;
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('redirect_uri')).toBe(`${origin}/oauth/google/callback`);
      expect(body.get('client_id')).toBe(env.GOOGLE_CLIENT_ID);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(await challenge(body.get('code_verifier') ?? '')).toBe(expectedGoogleChallenge);
      return Response.json({ id_token: idToken, access_token: 'mock-google-access-token' });
    }
    throw new Error('Unexpected external network request in local tests.');
  }));
});

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.AUTH_DB, env.TEST_MIGRATIONS);
  idToken = '';
  upstreamTokenCalls = 0;
});
afterAll(() => vi.unstubAllGlobals());

function request(path: string, init: RequestInit = {}) {
  return SELF.fetch(`${origin}${path}`, { ...init, redirect: 'manual' });
}

async function register(clientName = 'Local MCP test') {
  const response = await request('/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    client_name: clientName, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none',
  }) });
  expect(response.status).toBe(201);
  return await response.json() as { client_id: string };
}

async function begin(clientName?: string) {
  const client = await register(clientName);
  const verifier = 'a'.repeat(43);
  const params = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirectUri,
    scope: 'skills:read', state: 'client-state', code_challenge: await challenge(verifier), code_challenge_method: 'S256', resource: `${origin}/mcp` });
  const response = await request(`/authorize?${params}`);
  expect(response.status).toBe(303);
  const google = new URL(response.headers.get('Location')!);
  expect(google.origin).toBe('https://accounts.google.com');
  expect(google.searchParams.get('scope')).toBe('openid email');
  expect(google.searchParams.has('access_type')).toBe(false);
  expectedGoogleChallenge = google.searchParams.get('code_challenge')!;
  const cookie = response.headers.get('Set-Cookie')!.split(';')[0];
  expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
  expect(response.headers.get('Set-Cookie')).toContain('Secure');
  return { clientId: client.client_id, verifier, google, cookie };
}

type Flow = Awaited<ReturnType<typeof begin>>;
async function callback(flow: Flow, overrides: Record<string, unknown> = {}, cookie = flow.cookie, corruptSignature = false) {
  const now = Math.floor(Date.now() / 1000);
  idToken = await new SignJWT({ iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, sub: 'google-owner',
    email: env.OWNER_EMAIL, email_verified: true, iat: now, exp: now + 300, nonce: flow.google.searchParams.get('nonce'), ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(signingKey);
  if (corruptSignature) {
    const parts = idToken.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    idToken = parts.join('.');
  }
  return request(`/oauth/google/callback?${new URLSearchParams({ state: flow.google.searchParams.get('state')!, code: 'mock-google-code' })}`, { headers: { Cookie: cookie } });
}

async function approve(flow: Flow, callbackResponse: Response, extra: { origin?: string; cookie?: string; decision?: string } = {}) {
  const html = await callbackResponse.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
  expect(handle).toBeTruthy();
  return request('/consent', { method: 'POST', headers: { Cookie: extra.cookie ?? flow.cookie, Origin: extra.origin ?? origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ handle: handle!, decision: extra.decision ?? 'allow' }).toString() });
}

async function exchange(flow: Flow, code: string, overrides: Record<string, string> = {}) {
  return request('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
    grant_type: 'authorization_code', client_id: flow.clientId, code, code_verifier: flow.verifier,
    redirect_uri: redirectUri, resource: `${origin}/mcp`, ...overrides,
  }).toString() });
}

async function approvedCode(overrides: Record<string, unknown> = {}, clientName?: string) {
  const flow = await begin(clientName);
  const response = await callback(flow, overrides);
  expect(response.status).toBe(200);
  const approved = await approve(flow, response);
  expect(approved.status).toBe(303);
  const location = new URL(approved.headers.get('Location')!);
  expect(location.origin).toBe(new URL(redirectUri).origin);
  expect(location.searchParams.get('state')).toBe('client-state');
  expect(approved.headers.get('Set-Cookie')).toContain('Max-Age=0');
  return { flow, code: location.searchParams.get('code')! };
}

async function connect() {
  const { flow, code } = await approvedCode();
  const response = await exchange(flow, code);
  expect(response.status).toBe(200);
  const tokens = await response.json() as { access_token: string; refresh_token: string };
  const client = new Client({ name: 'Japanese Writing integration tests', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    fetch: (input, init) => SELF.fetch(input as RequestInfo, init),
  });
  await client.connect(transport);
  return { flow, tokens, client };
}

describe('OAuth boundary', () => {
  it('publishes discovery and challenges every unauthenticated MCP request', async () => {
    for (const path of ['/mcp', '/mcp/private']) {
      const response = await request(path);
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    }
    const resource = await (await request('/.well-known/oauth-protected-resource/mcp')).json() as { resource: string; authorization_servers: string[] };
    expect(resource.resource).toBe(`${origin}/mcp`);
    expect(resource.authorization_servers).toEqual([origin]);
    const metadata = await (await request('/.well-known/oauth-authorization-server')).json() as { code_challenge_methods_supported: string[]; scopes_supported: string[] };
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.scopes_supported).toEqual(['skills:read']);
    expect((await request('/mcp', { headers: { Authorization: 'Bearer forged-token' } })).status).toBe(401);
  });

  it('rejects unexpected hosts, browser origins, oversized forms, and registration bursts', async () => {
    expect((await SELF.fetch('https://attacker.example.test/mcp')).status).toBe(421);
    expect((await request('/mcp', { headers: { Origin: 'https://attacker.example.test' } })).status).toBe(403);
    expect((await request('/token', { method: 'POST', body: 'x'.repeat(16_385) })).status).toBe(413);
    for (let index = 0; index < 10; index++) await register();
    expect((await request('/register', { method: 'POST', body: '{}' })).status).toBe(429);
  });

  it('rejects missing PKCE, unregistered redirects, unknown scopes, and foreign resources', async () => {
    const { client_id } = await register();
    const valid = { response_type: 'code', client_id, redirect_uri: redirectUri, code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'skills:read', resource: `${origin}/mcp` };
    for (const change of [{ code_challenge_method: 'plain' }, { code_challenge: '' }, { redirect_uri: 'https://attacker.example.test/callback' }, { scope: 'admin' }, { resource: 'https://attacker.example.test/mcp' }]) {
      expect((await request(`/authorize?${new URLSearchParams({ ...valid, ...change })}`)).status).toBe(400);
    }
    expect((await env.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM auth_states').first<{ count: number }>())!.count).toBe(0);
  });

  it.each([
    ['unverified email', { email_verified: false }],
    ['wrong audience', { aud: 'another-client' }],
    ['wrong issuer', { iss: 'https://attacker.example.test' }],
    ['wrong nonce', { nonce: 'wrong-nonce' }],
    ['expired token', { exp: 1 }],
    ['missing subject', { sub: '' }],
    ['wrong presenter', { azp: 'another-client' }],
  ])('rejects %s from Google sign-in', async (_name, claims) => {
    const response = await callback(await begin(), claims);
    expect(response.status).toBe(401);
    expect((await env.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM members').first<{ count: number }>())!.count).toBe(0);
  });

  it('rejects a valid Google account that has not been invited', async () => {
    const response = await callback(await begin(), { sub: 'another-subject', email: 'other@example.test' });
    expect(response.status).toBe(403);
    expect((await env.AUTH_DB.prepare('SELECT COUNT(*) AS count FROM members').first<{ count: number }>())!.count).toBe(0);
  });

  it('rejects a forged Google signature even when every identity claim matches', async () => {
    const flow = await begin();
    expect((await callback(flow, {}, flow.cookie, true)).status).toBe(401);
  });

  it('binds Google state to the browser, expires it, and prevents replay', async () => {
    const flow = await begin();
    expect((await callback(flow, {}, '__Host-jw_flow=' + 'b'.repeat(43))).status).toBe(400);
    expect(upstreamTokenCalls).toBe(0);
    expect((await callback(flow)).status).toBe(200);
    expect((await callback(flow)).status).toBe(400);
    expect(upstreamTokenCalls).toBe(1);
    const expired = await begin();
    await env.AUTH_DB.prepare('UPDATE auth_states SET expires_at = 0').run();
    expect((await callback(expired)).status).toBe(400);
  });

  it('consumes parallel Google callbacks once', async () => {
    const flow = await begin();
    const responses = await Promise.all([callback(flow), callback(flow)]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
    expect(upstreamTokenCalls).toBe(1);
  });

  it('requires browser-bound consent, rejects CSRF, and escapes client-provided HTML', async () => {
    const flow = await begin('<img src=x onerror=alert(1)>');
    const callbackResponse = await callback(flow);
    const html = await callbackResponse.clone().text();
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(html).toContain(redirectUri);
    expect(callbackResponse.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect((await approve(flow, callbackResponse.clone(), { origin: 'https://attacker.example.test' })).status).toBe(403);
    expect((await approve(flow, callbackResponse.clone(), { cookie: '__Host-jw_flow=' + 'b'.repeat(43) })).status).toBe(400);
    expect((await approve(flow, callbackResponse.clone())).status).toBe(303);
    expect((await approve(flow, callbackResponse)).status).toBe(400);
  });

  it('returns a denial without issuing an authorization code', async () => {
    const flow = await begin();
    const result = await approve(flow, await callback(flow), { decision: 'deny' });
    const target = new URL(result.headers.get('Location')!);
    expect(target.searchParams.get('error')).toBe('access_denied');
    expect(target.searchParams.has('code')).toBe(false);
    expect(target.searchParams.get('state')).toBe('client-state');
  });

  it.each([
    ['wrong PKCE', { code_verifier: 'b'.repeat(43) }],
    ['wrong redirect', { redirect_uri: 'https://attacker.example.test/callback' }],
    ['wrong resource', { resource: 'https://attacker.example.test/mcp' }],
    ['wrong client', { client_id: 'unregistered' }],
  ])('rejects token exchange with %s', async (_name, fields) => {
    const { flow, code } = await approvedCode();
    const result = await exchange(flow, code, fields);
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.status).toBeLessThan(500);
  });

  it('does not allow an authorization code to be reused', async () => {
    const { flow, code } = await approvedCode();
    expect((await exchange(flow, code)).status).toBe(200);
    expect((await exchange(flow, code)).status).toBe(400);
  });

  it('expires consent and rejects a previously valid access token after its lifetime', async () => {
    const flow = await begin();
    const callbackResponse = await callback(flow);
    await env.AUTH_DB.prepare("UPDATE auth_states SET expires_at = 0 WHERE kind = 'consent'").run();
    expect((await approve(flow, callbackResponse)).status).toBe(400);
    const connected = await connect();
    await connected.client.close();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    try {
      expect((await request('/mcp', { headers: { Authorization: `Bearer ${connected.tokens.access_token}` } })).status).toBe(401);
    } finally { clock.mockRestore(); }
  });
});

describe('authenticated skills and membership', () => {
  it('completes Google-to-OAuth-to-MCP, exposes guidance, resources, prompts, and precise counting', async () => {
    const { client, tokens } = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['list_skills', 'get_writing_guidance', 'read_writing_reference', 'count_characters']));
    const guidance = await client.callTool({ name: 'get_writing_guidance', arguments: { purpose: 'apology', operation: 'translate' } });
    const paths = (guidance.structuredContent as { documents: { path: string }[] }).documents.map(document => document.path);
    expect(paths).toEqual(['SKILL.md', 'references/sensitive-messages.md', 'references/translation-and-bilingual.md']);
    const counted = await client.callTool({ name: 'count_characters', arguments: { text: 'あ😀\n B', constraint: { kind: 'exact', limit: 4 } } });
    expect(counted.structuredContent).toMatchObject({ count: 4, constraint: { passed: true } });
    expect(JSON.stringify(counted)).not.toContain('あ😀');
    for (const [unit, count] of [['codepoints', 7], ['graphemes', 1], ['utf16', 11], ['bytes', 25]] as const) {
      const emoji = await client.callTool({ name: 'count_characters', arguments: { text: '👨‍👩‍👧‍👦', unit } });
      expect(emoji.structuredContent).toMatchObject({ unit, count });
    }
    expect((await client.listResources()).resources).toHaveLength(10);
    expect((await client.readResource({ uri: 'skill://japanese-writing/SKILL.md' })).contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    expect((await client.listPrompts()).prompts.map(prompt => prompt.name)).toContain('japanese-writing');
    const prompt = await client.getPrompt({ name: 'japanese-writing', arguments: { request: 'Write a brief apology.', purpose: 'apology' } });
    expect(prompt.messages).toHaveLength(1);
    const forbidden = await client.callTool({ name: 'read_writing_reference', arguments: { path: '../.dev.vars' } });
    expect(forbidden.isError).toBe(true);
    const tooLarge = await request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: 'x'.repeat(262_145) });
    expect(tooLarge.status).toBe(413);
    await client.close();
  });

  it('supports 2025-era Streamable HTTP clients', async () => {
    const { flow, code } = await approvedCode();
    const result = await exchange(flow, code);
    const tokens = await result.json() as { access_token: string };
    const response = await request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1' } } }) });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('japanese-writing');
  });

  it('refreshes tokens and immediately blocks a suspended member and further refreshes', async () => {
    const { client, flow, tokens } = await connect();
    await client.close();
    const refresh = (token: string) => request('/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', client_id: flow.clientId, refresh_token: token, resource: `${origin}/mcp` }).toString() });
    const refreshed = await refresh(tokens.refresh_token);
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json() as { access_token: string; refresh_token: string };
    await env.AUTH_DB.prepare("UPDATE members SET status = 'suspended' WHERE google_sub = 'google-owner'").run();
    expect((await request('/mcp', { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status).toBe(403);
    expect((await request('/mcp', { headers: { Authorization: `Bearer ${next.access_token}` } })).status).toBe(403);
    expect((await refresh(next.refresh_token)).status).toBe(400);
    expect((await callback(await begin())).status).toBe(403);
  });

  it('allows an invited second user while preventing reuse of a bound email by another Google subject', async () => {
    await env.AUTH_DB.prepare("INSERT INTO members(id, invited_email, role, status, skills_json, created_at, updated_at) VALUES ('invited-member', 'friend@example.test', 'member', 'active', '[\"japanese-writing\"]', 0, 0)").run();
    const { flow, code } = await approvedCode({ sub: 'google-friend', email: 'friend@example.test' });
    expect((await exchange(flow, code)).status).toBe(200);
    expect((await callback(await begin(), { sub: 'different-google-account', email: 'friend@example.test' })).status).toBe(403);
    expect((await callback(await begin(), { sub: 'google-friend', email: 'renamed@example.test' })).status).toBe(200);
    const rows = await env.AUTH_DB.prepare('SELECT id, role, google_sub FROM members').all();
    expect(rows.results).toEqual([{ id: 'invited-member', role: 'member', google_sub: 'google-friend' }]);
  });
});
