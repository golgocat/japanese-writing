const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254 || email.includes(":")) return null;
  if (!EMAIL.test(email)) return null;
  return email;
}

export function parseAllowlist(raw: string | null): string[] {
  if (raw === null || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const emails: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const email = normalizeEmail(item);
    if (email) emails.push(email);
  }
  return emails;
}

export async function isEmailAllowed(
  kv: { get(key: string): Promise<string | null> },
  email: string,
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const list = parseAllowlist(await kv.get("emails"));
  return list.includes(normalized);
}
