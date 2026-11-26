import type { JWTVerifyGetKey } from "jose";
import { createRemoteJWKSet } from "jose";
import {
  readAccessConfig,
  verifyAccessEmail,
  type AccessEvent,
} from "./access-identity.ts";
import { isEmailAllowed } from "./allowlist.ts";
import type { Env } from "./env.ts";

const GENERIC = "Sign-in did not complete. Return to your app and start again.";

let testKeys: JWTVerifyGetKey | undefined;

export function setAccessKeysForTests(keys: JWTVerifyGetKey | undefined) {
  testKeys = keys;
}

export async function handleDefault(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/") return home();
  if (url.pathname === "/authorize") return authorize(request, env);
  return new Response("Not found", { status: 404 });
}

function home(): Response {
  return Response.json({
    service: "japanese-writing",
    mcp: "/mcp",
    signIn: "/authorize",
  });
}

async function authorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  let authRequest: Awaited<ReturnType<typeof oauth.parseAuthRequest>>;
  try {
    authRequest = await oauth.parseAuthRequest(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "This sign-in link is not valid.";
    return text(message, 400);
  }

  const identity = await identify(request, env);
  if (!identity.ok) {
    console.error(JSON.stringify({ event: identity.event }));
    return text(GENERIC, 401);
  }

  const form = request.method === "POST" ? await request.formData() : null;
  if (form) {
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "allow") {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const approved = await oauth.approveConsent(request, handle, {
      scope: grantedScope(authRequest.scope),
    });
    const completed = await oauth.completeAuthorization({
      request: approved.request,
      userId: identity.email,
      metadata: {},
      scope: grantedScope(approved.request.scope),
      props: { email: identity.email },
    });
    approved.headers.set("Location", completed.redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  }

  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  consent.headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(consentPage(details, consent.handle), { headers: consent.headers });
}

async function identify(
  request: Request,
  env: Env,
): Promise<{ ok: true; email: string } | { ok: false; event: AccessEvent }> {
  const config = readAccessConfig(env.ACCESS_TEAM_DOMAIN, env.ACCESS_POLICY_AUD);
  if (!config) return { ok: false, event: "access_config_missing" };
  const keys = testKeys ?? remoteKeys(config.certsUrl);
  const verified = await verifyAccessEmail({
    token: request.headers.get("cf-access-jwt-assertion"),
    config,
    keys,
    now: new Date(),
  });
  if (!verified.ok) return verified;
  if (!(await isEmailAllowed(env.ALLOWLIST, verified.email))) {
    return { ok: false, event: "access_email_rejected" };
  }
  return verified;
}

const remoteCache = new Map<string, JWTVerifyGetKey>();

function remoteKeys(certsUrl: URL): JWTVerifyGetKey {
  const href = certsUrl.href;
  const cached = remoteCache.get(href);
  if (cached) return cached;
  const keys = createRemoteJWKSet(certsUrl);
  remoteCache.set(href, keys);
  return keys;
}

export function grantedScope(requested: string[]): string[] {
  const allowed = new Set(["mcp", "offline_access"]);
  const scope = requested.filter((item) => allowed.has(item));
  return scope.includes("mcp") ? scope : ["mcp", ...scope];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function consentPage(
  details: { clientName: string; redirectHost: string; redirectIsLoopback: boolean },
  handle: string,
): string {
  const local = details.redirectIsLoopback
    ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>"
    : "";
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Allow access</title>
<h1>Allow access</h1>
<p>Allow ${escapeHtml(details.clientName)} to use the 対訳 check. Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${local}
<form method="post">
  <input type="hidden" name="handle" value="${escapeHtml(handle)}">
  <button name="decision" value="allow" type="submit">Allow</button>
  <button name="decision" value="deny" type="submit">Deny</button>
</form>`;
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
