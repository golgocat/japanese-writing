import { decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from "jose";
import { normalizeEmail } from "./allowlist.ts";

const ALLOWED_ALG = "RS256";

export type AccessConfig = {
  teamDomain: string;
  audience: string;
  certsUrl: URL;
};

export type AccessEvent =
  | "access_config_missing"
  | "access_jwt_missing"
  | "access_jwt_rejected"
  | "access_email_rejected";

export function readAccessConfig(
  teamDomain: string | undefined,
  audience: string | undefined,
): AccessConfig | null {
  if (!teamDomain || !audience) return null;
  const aud = audience.trim();
  if (aud.length === 0 || aud.length > 200 || /\s/.test(aud)) return null;
  const certsUrl = accessCertsUrl(teamDomain);
  if (!certsUrl) return null;
  return { teamDomain: certsUrl.origin, audience: aud, certsUrl };
}

export function accessCertsUrl(teamDomain: string): URL | null {
  let url: URL;
  try {
    url = new URL(teamDomain.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname)) return null;
  return new URL("/cdn-cgi/access/certs", url.origin);
}

export async function verifyAccessEmail(input: {
  token: string | null;
  config: AccessConfig;
  keys: JWTVerifyGetKey;
  now: Date;
}): Promise<{ ok: true; email: string } | { ok: false; event: "access_jwt_missing" | "access_jwt_rejected" }> {
  if (!input.token) return { ok: false, event: "access_jwt_missing" };
  let headerAlg: string | undefined;
  try {
    headerAlg = decodeProtectedHeader(input.token).alg;
  } catch {
    return { ok: false, event: "access_jwt_rejected" };
  }
  if (headerAlg !== ALLOWED_ALG) return { ok: false, event: "access_jwt_rejected" };
  try {
    const { payload } = await jwtVerify(input.token, input.keys, {
      algorithms: [ALLOWED_ALG],
      issuer: input.config.teamDomain,
      audience: input.config.audience,
      clockTolerance: 0,
      currentDate: input.now,
    });
    const email = typeof payload.email === "string" ? normalizeEmail(payload.email) : null;
    if (!email) return { ok: false, event: "access_jwt_rejected" };
    return { ok: true, email };
  } catch {
    return { ok: false, event: "access_jwt_rejected" };
  }
}
