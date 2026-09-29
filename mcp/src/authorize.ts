import { isEmailAllowed, normalizeEmail } from "./allowlist.ts";
import type { Env } from "./env.ts";
import { sendSignInCode } from "./mail.ts";
import { consumeCode, openEmail, randomCode, saveCode, sealEmail } from "./sign-in.ts";

const COOKIE = "jw_signin";

export async function handleDefault(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/") return home(env);
  if (url.pathname === "/authorize") return authorize(request, env);
  return new Response("Not found", { status: 404 });
}

function home(env: Env): Response {
  const mailReady = Boolean(env.AGENTMAIL_API_KEY && env.AGENTMAIL_INBOX_ID);
  const mailLine = mailReady
    ? "Sign in with the email address that was registered in advance."
    : "Sign-in email is not turned on yet, so a code cannot be sent.";
  return Response.json({
    service: "japanese-writing",
    mcp: "/mcp",
    signIn: "/authorize",
    mail: mailLine,
  });
}

async function authorize(request: Request, env: Env): Promise<Response> {
  if (!env.SIGN_IN_PEPPER) {
    return text("Sign-in is not ready.", 503);
  }
  const oauth = env.OAUTH_PROVIDER;
  let authRequest: Awaited<ReturnType<typeof oauth.parseAuthRequest>>;
  try {
    authRequest = await oauth.parseAuthRequest(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "This sign-in link is not valid.";
    return text(message, 400);
  }
  const details = await oauth.describeConsent(authRequest);
  const form = request.method === "POST" ? await request.formData() : null;
  const step = form?.get("step");

  if (step === "code") {
    const token = readCookie(request, COOKIE);
    const email = token ? await openEmail(token, env.SIGN_IN_PEPPER, nowSeconds()) : null;
    const code = String(form?.get("code") ?? "");
    const ok =
      email !== null &&
      (await consumeCode(env.ALLOWLIST, email, code, env.SIGN_IN_PEPPER));
    if (!ok || email === null) {
      return html(codePage(details, "That code is wrong or expired."), 400);
    }
    const completed = await oauth.completeAuthorization({
      request: authRequest,
      userId: email,
      metadata: {},
      scope: grantedScope(authRequest.scope),
      props: { email },
    });
    return Response.redirect(completed.redirectTo, 302);
  }

  if (step === "email") {
    const email = normalizeEmail(String(form?.get("email") ?? ""));
    if (email && (await isEmailAllowed(env.ALLOWLIST, email))) {
      const code = randomCode();
      await saveCode(env.ALLOWLIST, email, code, env.SIGN_IN_PEPPER);
      const sent = await sendSignInCode(env, email, code);
      if (sent === "sent") {
        const sealed = await sealEmail(email, env.SIGN_IN_PEPPER, nowSeconds());
        return html(codePage(details, "If this address is registered, a code is on its way."), 200, {
          "Set-Cookie": cookie(sealed),
        });
      }
      await env.ALLOWLIST.delete(`otp:${email}`);
      console.error(JSON.stringify({ event: "sign_in_mail", result: sent }));
    }
    return html(codePage(details, "If this address is registered, a code is on its way."));
  }

  return html(emailPage(details));
}

function grantedScope(requested: string[]): string[] {
  const allowed = new Set(["mcp", "offline_access"]);
  const scope = requested.filter((item) => allowed.has(item));
  return scope.includes("mcp") ? scope : ["mcp", ...scope];
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookie(value: string): string {
  return `${COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

type Consent = {
  clientName: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
};

function emailPage(details: Consent): string {
  return layout(
    details,
    `<form method="post">
      <label>Email <input name="email" type="email" autocomplete="username" required></label>
      <input type="hidden" name="step" value="email">
      <button type="submit">Send a code</button>
    </form>`,
    "",
  );
}

function codePage(details: Consent, notice: string): string {
  return layout(
    details,
    `<form method="post">
      <label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" required></label>
      <input type="hidden" name="step" value="code">
      <button type="submit">Sign in</button>
    </form>`,
    notice,
  );
}

function layout(details: Consent, form: string, notice: string): string {
  const local = details.redirectIsLoopback
    ? "<p><strong>This sends access to an app on your computer.</strong> Continue only if you just started signing in from it.</p>"
    : "";
  return `<!doctype html>
<meta charset="utf-8">
<title>Sign in</title>
<h1>Sign in to Japanese writing</h1>
<p>Allow ${escapeHtml(details.clientName)} to use the 対訳 check. Access will be sent to <strong>${escapeHtml(details.redirectHost)}</strong>.</p>
${local}
${notice ? `<p>${escapeHtml(notice)}</p>` : ""}
${form}`;
}

function html(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...headers },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
