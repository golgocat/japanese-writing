import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { test } from "node:test";
import { accessCertsUrl, readAccessConfig, verifyAccessEmail } from "./access-identity.ts";

const team = "https://team.cloudflareaccess.com";
const audience = "aud-tag";
const now = new Date("2026-09-29T03:00:00Z");

async function fixture() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  jwk.alg = "RS256";
  jwk.use = "sig";
  jwk.kid = "test-key";
  const keys = createLocalJWKSet({ keys: [jwk] });
  const config = readAccessConfig(team, audience);
  assert.ok(config);
  return { privateKey, keys, config };
}

async function sign(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  header: { alg: string } = { alg: "RS256" },
) {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ ...header, kid: "test-key" })
    .setSubject("user");
  return jwt.sign(privateKey);
}

function baseClaims(extra: Record<string, unknown> = {}) {
  return {
    iss: team,
    aud: audience,
    email: "Ada@Example.com",
    iat: Math.floor(now.getTime() / 1000) - 10,
    exp: Math.floor(now.getTime() / 1000) + 600,
    nbf: Math.floor(now.getTime() / 1000) - 10,
    ...extra,
  };
}

test("builds the certs URL only from a Cloudflare Access team domain", () => {
  const certs = accessCertsUrl(team);
  assert.equal(certs?.href, "https://team.cloudflareaccess.com/cdn-cgi/access/certs");
  assert.equal(accessCertsUrl("https://evil.example/cdn-cgi/access/certs"), null);
  assert.equal(accessCertsUrl("http://team.cloudflareaccess.com"), null);
  assert.equal(accessCertsUrl("https://user:pass@team.cloudflareaccess.com"), null);
  assert.equal(accessCertsUrl("https://team.cloudflareaccess.com/other"), null);
  assert.equal(readAccessConfig(undefined, audience), null);
});

test("accepts a signed Access token and returns the normalized email", async () => {
  const { privateKey, keys, config } = await fixture();
  const token = await sign(privateKey, baseClaims());
  const result = await verifyAccessEmail({ token, config, keys, now });
  assert.deepEqual(result, { ok: true, email: "ada@example.com" });
});

test("rejects a tampered token, the wrong issuer, the wrong audience, and a bad lifetime", async () => {
  const { privateKey, keys, config } = await fixture();
  const token = await sign(privateKey, baseClaims());
  const tampered = `${token.slice(0, -4)}aaaa`;
  assert.equal(
    (await verifyAccessEmail({ token: tampered, config, keys, now })).ok,
    false,
  );
  const wrongIssuer = await sign(privateKey, baseClaims({ iss: "https://evil.cloudflareaccess.com" }));
  assert.equal(failure(await verifyAccessEmail({ token: wrongIssuer, config, keys, now })), "access_jwt_rejected");
  const wrongAudience = await sign(privateKey, baseClaims({ aud: "other-app" }));
  assert.equal(failure(await verifyAccessEmail({ token: wrongAudience, config, keys, now })), "access_jwt_rejected");
  const expired = await sign(privateKey, baseClaims({ exp: Math.floor(now.getTime() / 1000) - 60 }));
  assert.equal(failure(await verifyAccessEmail({ token: expired, config, keys, now })), "access_jwt_rejected");
  const notYet = await sign(privateKey, baseClaims({ nbf: Math.floor(now.getTime() / 1000) + 120 }));
  assert.equal(failure(await verifyAccessEmail({ token: notYet, config, keys, now })), "access_jwt_rejected");
});

test("rejects a signed token that omits exp", async () => {
  const { privateKey, keys, config } = await fixture();
  const { exp: _exp, ...claims } = baseClaims();
  void _exp;
  const token = await sign(privateKey, claims);
  assert.equal(failure(await verifyAccessEmail({ token, config, keys, now })), "access_jwt_rejected");
});

test("rejects algorithms other than RS256 and a missing token", async () => {
  const { keys, config } = await fixture();
  const noneToken = unsignedToken({ alg: "none" }, baseClaims());
  assert.equal(failure(await verifyAccessEmail({ token: noneToken, config, keys, now })), "access_jwt_rejected");
  const hsToken = await new SignJWT(baseClaims())
    .setProtectedHeader({ alg: "HS256" })
    .sign(new Uint8Array(32).fill(7));
  assert.equal(failure(await verifyAccessEmail({ token: hsToken, config, keys, now })), "access_jwt_rejected");
  assert.equal(failure(await verifyAccessEmail({ token: null, config, keys, now })), "access_jwt_missing");
});

function failure(result: Awaited<ReturnType<typeof verifyAccessEmail>>): string {
  assert.equal(result.ok, false);
  if (result.ok) return "";
  return result.event;
}

function unsignedToken(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode(header)}.${encode(payload)}.`;
}
