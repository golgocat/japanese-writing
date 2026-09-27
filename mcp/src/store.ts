import type { Env, Member } from './types';
import { SKILL_ID } from './types';

export function randomToken(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function hash(value: string): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }

export async function createState(env: Env, kind: 'google' | 'consent', binding: string, payload: unknown): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM auth_states WHERE expires_at <= ?').bind(now),
    env.AUTH_DB.prepare('INSERT INTO auth_states(id_hash, binding_hash, kind, payload, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await hash(token), await hash(binding), kind, JSON.stringify(payload), now + 600_000),
  ]);
  return token;
}

export async function consumeState<T>(env: Env, kind: 'google' | 'consent', token: string, binding: string): Promise<T | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[A-Za-z0-9_-]{43}$/.test(binding)) return null;
  // DELETE RETURNING makes consumption atomic, including parallel callback replays.
  const row = await env.AUTH_DB.prepare('DELETE FROM auth_states WHERE id_hash = ? AND binding_hash = ? AND kind = ? AND expires_at > ? RETURNING payload')
    .bind(await hash(token), await hash(binding), kind, Date.now()).first<{ payload: string }>();
  return row ? JSON.parse(row.payload) as T : null;
}

export function hasSkill(member: Member | null): member is Member {
  return member?.status === 'active' && Array.isArray(JSON.parse(member.skills_json))
    && JSON.parse(member.skills_json).includes(SKILL_ID);
}

export async function getMember(env: Env, id: string): Promise<Member | null> {
  return env.AUTH_DB.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<Member>();
}

export async function claimMember(env: Env, subject: string, email: string): Promise<Member | null> {
  const normalized = normalizeEmail(email);
  const now = Date.now();
  const existing = await env.AUTH_DB.prepare('SELECT * FROM members WHERE google_sub = ?').bind(subject).first<Member>();
  if (existing) {
    if (!hasSkill(existing)) return null;
    await env.AUTH_DB.prepare('UPDATE members SET last_email = ?, updated_at = ? WHERE id = ?').bind(normalized, now, existing.id).run();
    return { ...existing, last_email: normalized };
  }
  if (normalized === normalizeEmail(env.OWNER_EMAIL)) {
    // Do not reactivate a suspended owner or replace a previously bound Google subject.
    await env.AUTH_DB.prepare("INSERT INTO members(id, invited_email, role, status, skills_json, created_at, updated_at) VALUES (?, ?, 'owner', 'active', ?, ?, ?) ON CONFLICT(invited_email) DO NOTHING")
      .bind(crypto.randomUUID(), normalized, JSON.stringify([SKILL_ID]), now, now).run();
  }
  const claimed = await env.AUTH_DB.prepare("UPDATE members SET google_sub = ?, last_email = ?, updated_at = ? WHERE invited_email = ? AND google_sub IS NULL AND status = 'active' RETURNING *")
    .bind(subject, normalized, now, normalized).first<Member>();
  if (hasSkill(claimed)) return claimed;
  const concurrent = await env.AUTH_DB.prepare('SELECT * FROM members WHERE google_sub = ?').bind(subject).first<Member>();
  return hasSkill(concurrent) ? concurrent : null;
}

export async function takeRateLimit(env: Env, key: string, limit: number): Promise<boolean> {
  const now = Date.now();
  const bucket = `${Math.floor(now / 60_000)}:${await hash(key)}`;
  const [, result] = await env.AUTH_DB.batch([
    env.AUTH_DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now),
    env.AUTH_DB.prepare('INSERT INTO rate_limits(bucket, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 RETURNING count')
      .bind(bucket, now + 120_000),
  ]);
  return Number((result.results[0] as { count: number }).count) <= limit;
}
