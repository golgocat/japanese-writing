import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { test } from "node:test";
import { setAccessKeysForTests } from "./authorize.ts";
import { oauthFetch } from "./oauth-app.ts";
import type { Env } from "./env.ts";

const origin = "https://bilingual-mcp.southernbreeze.partners";
const team = "https://team.cloudflareaccess.com";
const audience = "aud-tag";
const redirectUri = "http://127.0.0.1/callback";

function memoryKv() {
  const map = new Map<string, string>();
  return {
    async get(key: string, type?: string | { type?: string }) {
      const raw = map.get(key);
      if (raw === undefined) return null;
      const kind = typeof type === "string" ? type : type?.type;
      return kind === "json" ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      map.set(key, value);
    },
    async delete(key: string) {
      map.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cursor: "" };
    },
  };
}

async function accessToken(email: string, privateKey: CryptoKey) {
  const issued = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: team,
    aud: audience,
    email,
    iat: issued - 60,
    exp: issued + 600,
    nbf: issued - 60,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject("user")
    .sign(privateKey);
}

function cookies(response: Response): string {
  const list = response.headers.getSetCookie?.() ?? [];
  return list.map((item) => item.split(";")[0]).join("; ");
}

test("anonymous /mcp returns an OAuth challenge, and a valid Access user can finish PKCE", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.kid = "test-key";
  const allow = memoryKv();
  await allow.put("emails", JSON.stringify(["ada@example.com"]));
  const env = {
    OAUTH_KV: memoryKv(),
    ALLOWLIST: allow,
    ACCESS_TEAM_DOMAIN: team,
    ACCESS_POLICY_AUD: audience,
  } as unknown as Env;
  setAccessKeysForTests(createLocalJWKSet({ keys: [jwk] }));

  const anonymous = await oauthFetch(
    new Request(`${origin}/mcp`, { method: "POST", body: "{}" }),
    env,
    {} as ExecutionContext,
    { fetch: async () => new Response("tool") },
  );
  assert.equal(anonymous.status, 401);
  const challenge = anonymous.headers.get("www-authenticate") ?? "";
  assert.match(challenge, /Bearer/);
  assert.match(challenge, new RegExp(origin.replaceAll(".", "\\.")));

  const registered = await oauthFetch(
    new Request(`${origin}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        client_name: "chatgpt-test",
      }),
    }),
    env,
    {} as ExecutionContext,
    { fetch: async () => new Response("tool") },
  );
  assert.equal(registered.status, 201);
  const client = (await registered.json()) as { client_id: string };
  const verifier = Buffer.from(randomBytes(32)).toString("base64url");
  const challengeCode = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challengeCode,
    code_challenge_method: "S256",
    scope: "mcp",
    state: "state-1",
    resource: `${origin}/mcp`,
  });
  const jwt = await accessToken("Ada@Example.com", privateKey);
  const page = await oauthFetch(
    new Request(`${origin}/authorize?${query}`, {
      headers: { "cf-access-jwt-assertion": jwt },
    }),
    env,
    {} as ExecutionContext,
    { fetch: async () => new Response("tool") },
  );
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Allow/);
  assert.doesNotMatch(html, /code is on its way/);
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(handle);
  const allowed = await oauthFetch(
    new Request(`${origin}/authorize?${query}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookies(page),
        "cf-access-jwt-assertion": jwt,
      },
      body: new URLSearchParams({ handle, decision: "allow" }),
    }),
    env,
    {} as ExecutionContext,
    { fetch: async () => new Response("tool") },
  );
  assert.equal(allowed.status, 302);
  const redirected = new URL(allowed.headers.get("location") ?? "");
  assert.equal(redirected.origin + redirected.pathname, redirectUri);
  assert.equal(redirected.searchParams.get("state"), "state-1");
  const code = redirected.searchParams.get("code");
  assert.ok(code);
  const traded = await oauthFetch(
    new Request(`${origin}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: `${origin}/mcp`,
      }),
    }),
    env,
    {} as ExecutionContext,
    { fetch: async () => new Response("tool") },
  );
  assert.equal(traded.status, 200);
  const token = (await traded.json()) as { access_token?: string };
  assert.equal(typeof token.access_token, "string");

  const outsider = await accessToken("other@example.com", privateKey);
  const rejected = await oauthFetch(
    new Request(`${origin}/authorize?${query}`, {
      headers: { "cf-access-jwt-assertion": outsider },
    }),
    env,
    {} as ExecutionContext,
    { fetch: async () => new Response("tool") },
  );
  assert.equal(rejected.status, 401);
  const body = await rejected.text();
  assert.match(body, /Sign-in did not complete/);
  assert.doesNotMatch(body, /other@example.com/);
  assert.doesNotMatch(body, /code is on its way/);
});
