const OTP_TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

type OtpRecord = {
  hash: string;
  attempts: number;
};

type OtpStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

export function randomCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const value = 100000 + ((bytes[0] ?? 0) % 900000);
  return String(value);
}

export async function hashCode(
  email: string,
  code: string,
  pepper: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${pepper}\n${email}\n${code}`),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sameHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function otpKey(email: string): string {
  return `otp:${email}`;
}

export async function saveCode(
  store: OtpStore,
  email: string,
  code: string,
  pepper: string,
): Promise<void> {
  const record: OtpRecord = {
    hash: await hashCode(email, code, pepper),
    attempts: 0,
  };
  await store.put(otpKey(email), JSON.stringify(record), {
    expirationTtl: OTP_TTL_SECONDS,
  });
}

export async function consumeCode(
  store: OtpStore,
  email: string,
  code: string,
  pepper: string,
): Promise<boolean> {
  const raw = await store.get(otpKey(email));
  if (raw === null) return false;
  let record: OtpRecord;
  try {
    record = JSON.parse(raw) as OtpRecord;
  } catch {
    await store.delete(otpKey(email));
    return false;
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await store.delete(otpKey(email));
    return false;
  }
  const expected = await hashCode(email, code, pepper);
  if (!sameHex(record.hash, expected)) {
    record.attempts += 1;
    await store.put(otpKey(email), JSON.stringify(record), {
      expirationTtl: OTP_TTL_SECONDS,
    });
    return false;
  }
  await store.delete(otpKey(email));
  return true;
}

type CookiePayload = {
  email: string;
  exp: number;
};

export async function sealEmail(
  email: string,
  pepper: string,
  nowSeconds: number,
): Promise<string> {
  const payload: CookiePayload = { email, exp: nowSeconds + OTP_TTL_SECONDS };
  const body = base64Url(JSON.stringify(payload));
  const sig = await hmac(body, pepper);
  return `${body}.${sig}`;
}

export async function openEmail(
  token: string,
  pepper: string,
  nowSeconds: number,
): Promise<string | null> {
  const splitAt = token.lastIndexOf(".");
  if (splitAt <= 0) return null;
  const body = token.slice(0, splitAt);
  const sig = token.slice(splitAt + 1);
  const expected = await hmac(body, pepper);
  if (!sameHex(sig, expected)) return null;
  let payload: CookiePayload;
  try {
    payload = JSON.parse(fromBase64Url(body)) as CookiePayload;
  } catch {
    return null;
  }
  if (payload.exp < nowSeconds || typeof payload.email !== "string") return null;
  return payload.email;
}

async function hmac(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Url(value: string): string {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): string {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = (4 - (padded.length % 4)) % 4;
  return atob(padded + "=".repeat(pad));
}
