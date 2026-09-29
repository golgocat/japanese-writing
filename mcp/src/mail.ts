import type { Env } from "./env.ts";

export async function sendSignInCode(
  env: Env,
  email: string,
  code: string,
): Promise<"sent" | "not_configured" | "failed"> {
  const key = env.AGENTMAIL_API_KEY;
  const inbox = env.AGENTMAIL_INBOX_ID;
  if (!key || !inbox) return "not_configured";
  const response = await fetch(
    `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: [email],
        subject: "Japanese writing sign-in code",
        text: `Your sign-in code is ${code}. It expires in 10 minutes. If you did not ask to sign in, ignore this message.`,
      }),
    },
  );
  return response.ok ? "sent" : "failed";
}
