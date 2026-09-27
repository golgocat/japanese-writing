import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Env } from './types';
import { SCOPE } from './types';
import { claimMember, consumeState, createState, getMember, hasSkill, randomToken } from './store';
import { appOrigin, escapeHtml, flowCookie, jsonError, page, readFlowCookie, redirect } from './http';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

interface GoogleState { auth: AuthRequest; nonce: string; verifier: string; }
interface ConsentState { auth: AuthRequest; memberId: string; }

async function pkceChallenge(verifier: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function configured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.OWNER_EMAIL ?? ''));
}

async function authorize(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return jsonError(503, 'temporarily_unavailable', 'Google sign-in has not been configured.');
  let auth: AuthRequest;
  try { auth = await env.OAUTH_PROVIDER.parseAuthRequest(request); }
  catch { return jsonError(400, 'invalid_request', 'Invalid authorization request.'); }
  if (auth.responseType !== 'code' || auth.codeChallengeMethod !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(auth.codeChallenge ?? '')) {
    return jsonError(400, 'invalid_request', 'Authorization code flow with PKCE S256 is required.');
  }
  if (auth.resource !== `${appOrigin(env)}/mcp` || auth.scope.some(scope => scope !== SCOPE)) {
    return jsonError(400, 'invalid_scope', 'Only the Japanese Writing resource and skills:read scope are supported.');
  }
  if (auth.scope.length === 0) auth.scope = [SCOPE];
  const client = await env.OAUTH_PROVIDER.lookupClient(auth.clientId);
  if (!client || !client.redirectUris.includes(auth.redirectUri)) return jsonError(400, 'invalid_client', 'The client or redirect URI is not registered.');
  const binding = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const state = await createState(env, 'google', binding, { auth, nonce, verifier } satisfies GoogleState);
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${appOrigin(env)}/oauth/google/callback`,
    response_type: 'code', scope: 'openid email', state, nonce, prompt: 'select_account',
    code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256',
  }).toString();
  return redirect(url.href, flowCookie(env, binding));
}

async function googleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const binding = readFlowCookie(request, env);
  const saved = await consumeState<GoogleState>(env, 'google', url.searchParams.get('state') ?? '', binding);
  if (!saved) return jsonError(400, 'invalid_request', 'This sign-in request is invalid or has expired. Start the connection again.');
  if (url.searchParams.has('error')) return page('Sign-in canceled', '<p>No connection was authorized. You can return to your MCP client and start again.</p>', 400);
  const code = url.searchParams.get('code');
  if (!code || code.length > 4096) return jsonError(400, 'invalid_request', 'Missing or invalid Google authorization code.');
  let identity: { sub: string; email: string };
  try {
    const result = await fetch(GOOGLE_TOKEN, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${appOrigin(env)}/oauth/google/callback`, code_verifier: saved.verifier }),
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!result.ok) throw new Error('Google token exchange failed.');
    const tokens = await result.json() as { id_token?: string };
    if (typeof tokens.id_token !== 'string') throw new Error('Missing ID token.');
    const { payload } = await jwtVerify(tokens.id_token, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: env.GOOGLE_CLIENT_ID,
      algorithms: ['RS256'], requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'nonce', 'email', 'email_verified'],
      maxTokenAge: '10m', clockTolerance: 5,
    });
    if (payload.nonce !== saved.nonce || payload.email_verified !== true || typeof payload.email !== 'string'
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) || !payload.sub || payload.sub.length > 255
      || (payload.azp !== undefined && payload.azp !== env.GOOGLE_CLIENT_ID)) throw new Error('Invalid identity claims.');
    identity = { sub: payload.sub, email: payload.email };
  } catch {
    return jsonError(401, 'access_denied', 'Google identity could not be verified. Start the connection again.');
  }
  const member = await claimMember(env, identity.sub, identity.email);
  if (!member) return page('Access is restricted', '<p>This Google account does not have access to Japanese Writing. Sign in with an invited account.</p>', 403);
  const client = await env.OAUTH_PROVIDER.lookupClient(saved.auth.clientId);
  if (!client || !client.redirectUris.includes(saved.auth.redirectUri)) return jsonError(400, 'invalid_client', 'The client is no longer registered.');
  const consent = await createState(env, 'consent', binding, { auth: saved.auth, memberId: member.id } satisfies ConsentState);
  return consentPage({ email: identity.email, clientName: client.clientName ?? 'Unnamed MCP client', redirectUri: saved.auth.redirectUri, handle: consent });
}

export function consentPage(input: { email: string; clientName: string; redirectUri: string; handle: string }): Response {
  return page('Connect your writing assistant', `
    <p><strong>${escapeHtml(input.clientName)}</strong> is requesting access to Japanese Writing.</p>
    <div class="account">Signed in as <strong>${escapeHtml(input.email)}</strong></div>
    <ul><li>Read Japanese writing guides and templates.</li><li>Measure the text you send to the character counter.</li></ul>
    <p>Your drafts are not saved by this server. Google access is limited to your sign-in identity and email address.</p>
    <small>Client names are self-reported. Check the return address before allowing access:</small>
    <p><code>${escapeHtml(input.redirectUri)}</code></p>
    <form method="post" action="/consent"><input type="hidden" name="handle" value="${escapeHtml(input.handle)}">
      <div class="actions"><button class="primary" type="submit" name="decision" value="allow">Allow access</button><button type="submit" name="decision" value="deny">Cancel</button></div>
    </form>`);
}

async function consent(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('Origin') !== appOrigin(env)) return jsonError(403, 'access_denied', 'Invalid form origin.');
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) return jsonError(415, 'invalid_request', 'Expected a form submission.');
  const form = await request.formData();
  const handle = form.get('handle');
  const decision = form.get('decision');
  if (typeof handle !== 'string' || typeof decision !== 'string' || form.getAll('handle').length !== 1 || form.getAll('decision').length !== 1 || !['allow', 'deny'].includes(decision)) {
    return jsonError(400, 'invalid_request', 'Invalid consent form.');
  }
  const saved = await consumeState<ConsentState>(env, 'consent', handle, readFlowCookie(request, env));
  if (!saved) return jsonError(400, 'invalid_request', 'This consent request is invalid or has expired. Start the connection again.');
  const clear = flowCookie(env, '', true);
  if (decision === 'deny') {
    const destination = new URL(saved.auth.redirectUri);
    destination.searchParams.set('error', 'access_denied');
    destination.searchParams.set('state', saved.auth.state);
    destination.searchParams.set('iss', appOrigin(env));
    return redirect(destination.href, clear);
  }
  const member = await getMember(env, saved.memberId);
  if (!hasSkill(member)) return jsonError(403, 'access_denied', 'Access is no longer available.');
  const result = await env.OAUTH_PROVIDER.completeAuthorization({
    request: saved.auth, userId: member.id, scope: [SCOPE], metadata: { label: 'Japanese Writing' },
    props: { userId: member.id, resource: `${appOrigin(env)}/mcp`, scopes: [SCOPE] },
  });
  return redirect(result.redirectTo, clear);
}

export async function handleAuth(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/authorize' && request.method === 'GET') return authorize(request, env);
  if (url.pathname === '/oauth/google/callback' && request.method === 'GET') return googleCallback(request, env);
  if (url.pathname === '/consent' && request.method === 'POST') return consent(request, env);
  if (url.pathname === '/' && request.method === 'GET') return page('Japanese that fits your purpose', `<p>Writing guides, bilingual text, and accurate character counts for your AI assistant.</p><p>Add this MCP endpoint to your client, then sign in with your invited Google account:</p><p><code>${escapeHtml(appOrigin(env))}/mcp</code></p><small>Access is invitation-only. Your AI assistant writes the text; this server provides the writing skill and character counter.</small>`);
  return jsonError(404, 'not_found', 'Not found.');
}
