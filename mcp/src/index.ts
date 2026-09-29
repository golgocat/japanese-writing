import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";
import { isEmailAllowed } from "./allowlist.ts";
import { handleDefault } from "./authorize.ts";
import type { Env } from "./env.ts";
import procedure from "../../references/translation-and-bilingual.md";
import {
  accuracyPrompt,
  jobFromToolInput,
  languages,
  prepareReview,
  units,
} from "./taiyaku.ts";

const toolInput = z.object({
  source_text: z.string(),
  source_language: z.enum(languages),
  translation_text: z.string().optional(),
  translation_language: z.enum(languages).optional(),
  unit: z.enum(units).optional(),
});

const promptInput = z.object({
  source_text: z.string(),
  source_language: z.enum(languages),
  translation_text: z.string(),
  translation_language: z.enum(languages),
  unit: z.enum(units).optional(),
});

function createServer() {
  const server = new McpServer({
    name: "japanese-writing",
    version: "1.0.0",
  });

  server.registerTool(
    "align_for_review",
    {
      title: "Align a 対訳 for review",
      description:
        "Segment a source for line-by-line 対訳, or pair it with an existing translation. Equal counts stay in order. Unequal counts are a mismatch. This does not translate and does not judge meaning.",
      inputSchema: toolInput,
    },
    async (args) => {
      const parsed = jobFromToolInput({
        source_text: args.source_text,
        source_language: args.source_language,
        translation_text: args.translation_text,
        translation_language: args.translation_language,
        unit: args.unit,
      });
      if (!parsed.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: parsed.error }],
        };
      }
      const review = prepareReview(parsed.job);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(review),
          },
        ],
      };
    },
  );

  server.registerPrompt(
    "check_translation_accuracy",
    {
      title: "Check translation accuracy",
      description:
        "Ask the agent to check an existing translation against the 対訳 rubric. The agent calls align_for_review, then writes the verdict.",
      argsSchema: promptInput,
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: accuracyPrompt({
              source_text: args.source_text,
              source_language: args.source_language,
              translation_text: args.translation_text,
              translation_language: args.translation_language,
              unit: args.unit,
            }),
          },
        },
      ],
    }),
  );

  server.registerResource(
    "translation-and-bilingual",
    "japanese-writing://references/translation-and-bilingual",
    {
      title: "翻訳・対訳・やさしい日本語",
      description:
        "The japanese-writing procedure for translation, line-by-line 対訳, and plain Japanese.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: procedure,
        },
      ],
    }),
  );

  return server;
}

const mcp = createMcpHandler(createServer);

const apiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const email = readPropEmail(ctx);
    if (!(await isEmailAllowed(env.ALLOWLIST, email))) {
      return new Response("This email is not on the list.", { status: 403 });
    }
    return mcp(request, env, ctx);
  },
};

function readPropEmail(ctx: ExecutionContext): string {
  const props = (ctx as ExecutionContext & { props?: { email?: unknown } }).props;
  return typeof props?.email === "string" ? props.email : "";
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const origin = new URL(request.url).origin;
    const provider = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler,
      defaultHandler: { fetch: handleDefault },
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
  },
};
