import { OAuthError, OAuthProvider, type OAuthResourceContext } from '@cloudflare/workers-oauth-provider';
import type { Env, GrantProps } from './types';
import { SCOPE } from './types';
import { getMember, hasSkill, takeRateLimit } from './store';
import { appOrigin, jsonError, privateHeaders } from './http';
import { handleAuth } from './auth';
import { mcpHandler } from './skills';
import { bundle } from './generated/skill';

const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const context = ctx as OAuthResourceContext<GrantProps>;
    const canonical = `${appOrigin(env)}/mcp`;
    if (new URL(request.url).pathname !== '/mcp') return jsonError(404, 'not_found', 'Not found.');
    if (context.auth.audience !== canonical || context.props.resource !== canonical || context.auth.userId !== context.props.userId) {
      return bearerError(env, 401, 'invalid_token', 'Token is not valid for this resource.');
    }
    if (!context.auth.scope.includes(SCOPE)) return bearerError(env, 403, 'insufficient_scope', 'The skills:read scope is required.');
    if (!hasSkill(await getMember(env, context.props.userId))) return jsonError(403, 'access_denied', 'Skill access is not available.');
    if (!await takeRateLimit(env, `member:${context.props.userId}`, 120)) return jsonError(429, 'rate_limited', 'Please retry in one minute.');
    return mcpHandler.fetch(request, { authInfo: { token: context.auth.token, clientId: context.auth.clientId ?? '', scopes: context.auth.scope, expiresAt: context.auth.expiresAt } });
  },
};

function bearerError(env: Env, status: number, error: string, message: string): Response {
  const response = jsonError(status, error, message);
  response.headers.set('WWW-Authenticate', `Bearer error="${error}", scope="${SCOPE}", resource_metadata="${appOrigin(env)}/.well-known/oauth-protected-resource/mcp"`);
  return response;
}

function provider(env: Env): OAuthProvider<Env> {
  const origin = appOrigin(env);
  return new OAuthProvider<Env>({
    apiRoute: `${origin}/mcp`, apiHandler,
    defaultHandler: { fetch: handleAuth },
    authorizeEndpoint: `${origin}/authorize`, tokenEndpoint: `${origin}/token`, clientRegistrationEndpoint: `${origin}/register`,
    scopesSupported: [SCOPE], allowImplicitFlow: false, allowPlainPKCE: false,
    accessTokenTTL: 900, refreshTokenTTL: 2_592_000, clientRegistrationTTL: 2_592_000,
    clientIdMetadataDocumentEnabled: false, allowTokenExchangeGrant: false,
    resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Japanese Writing' },
    async tokenExchangeCallback(options) {
      const props = options.props as GrantProps;
      if (!props || props.userId !== options.userId || props.resource !== `${origin}/mcp` || options.resource !== `${origin}/mcp`
        || !options.requestedScope.includes(SCOPE) || !hasSkill(await getMember(env, options.userId))) {
        throw new OAuthError('invalid_grant', { description: 'Skill access is no longer available.' });
      }
    },
    // Library defaults include descriptions in console logs; keep OAuth values out of logs.
    onError() {},
  });
}

async function boundedBody(request: Request, limit: number): Promise<Request | null> {
  if (!request.body) return request;
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new Request(request, { body: bytes });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const origin = appOrigin(env);
      const url = new URL(request.url);
      if (url.origin !== origin) return jsonError(421, 'invalid_request', 'Use the configured service origin.');
      const browserOrigin = request.headers.get('Origin');
      const allowedOrigins = new Set([origin, ...JSON.parse(env.MCP_BROWSER_ORIGINS ?? '[]') as string[]]);
      if (url.pathname.startsWith('/mcp') && browserOrigin && !allowedOrigins.has(browserOrigin)) {
        return jsonError(403, 'access_denied', 'Browser origin is not allowed.');
      }
      if (url.pathname === '/health' && request.method === 'GET') {
        return Response.json({ service: 'japanese-writing-mcp', status: 'ok', authentication: 'required', skillVersion: bundle.version }, { headers: privateHeaders() });
      }
      if (request.method !== 'OPTIONS' && ['/authorize', '/oauth/google/callback', '/consent', '/register', '/token'].includes(url.pathname)) {
        const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
        const limit = url.pathname === '/register' ? 10 : 60;
        if (!await takeRateLimit(env, `${url.pathname}:${ip}`, limit)) {
          return new Response('Please retry in one minute.', { status: 429, headers: privateHeaders({ 'Retry-After': '60' }) });
        }
        if (request.method === 'POST') {
          const limited = await boundedBody(request, 16_384);
          if (!limited) return jsonError(413, 'invalid_request', 'Request body is too large.');
          request = limited;
        }
      }
      const response = await provider(env).fetch(request, env, ctx);
      const headers = privateHeaders(response.headers);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch {
      return jsonError(503, 'temporarily_unavailable', 'The service is temporarily unavailable.');
    }
  },
} satisfies ExportedHandler<Env>;
