import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { handleDefault } from "./authorize.ts";
import type { Env } from "./env.ts";

type ApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response;
};

export function oauthFetch(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  apiHandler: ApiHandler,
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler,
    defaultHandler: {
      fetch(incoming, incomingEnv) {
        return handleDefault(incoming, incomingEnv);
      },
    },
    authorizeEndpoint: `${origin}/authorize`,
    tokenEndpoint: `${origin}/oauth/token`,
    clientRegistrationEndpoint: `${origin}/oauth/register`,
    scopesSupported: ["mcp", "offline_access"],
    requiredScopes: ["mcp"],
    allowPrivateUseRedirectUris: true,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      resource_name: "Japanese writing",
    },
  });
  return provider.fetch(request, env, ctx);
}
