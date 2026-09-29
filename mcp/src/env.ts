import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export type Env = {
  OAUTH_KV: KVNamespace;
  ALLOWLIST: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_POLICY_AUD?: string;
};
