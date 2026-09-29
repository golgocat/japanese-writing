import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

export type Env = {
  OAUTH_KV: KVNamespace;
  ALLOWLIST: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  SIGN_IN_PEPPER: string;
  AGENTMAIL_API_KEY?: string;
  AGENTMAIL_INBOX_ID?: string;
};
