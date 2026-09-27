import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OWNER_EMAIL: string;
  MCP_BROWSER_ORIGINS?: string;
  OAUTH_KV: KVNamespace;
  AUTH_DB: D1Database;
  OAUTH_PROVIDER: OAuthHelpers;
}

export interface GrantProps {
  userId: string;
  resource: string;
  scopes: string[];
}

export interface Member {
  id: string;
  invited_email: string;
  google_sub: string | null;
  last_email: string | null;
  role: 'owner' | 'member';
  status: 'active' | 'suspended';
  skills_json: string;
}

export const SCOPE = 'skills:read';
export const SKILL_ID = 'japanese-writing';
