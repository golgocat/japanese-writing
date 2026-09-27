import type { Env } from './types';

export function appOrigin(env: Env): string {
  const url = new URL(env.APP_ORIGIN);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Invalid canonical origin.');
  }
  return url.origin;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function privateHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return headers;
}

export function jsonError(status: number, error: string, message: string): Response {
  return Response.json({ error, error_description: message }, { status, headers: privateHeaders() });
}

export function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Japanese Writing</title><style>
    :root{font-family:system-ui,sans-serif;color:#18251f;background:#f5f6f2}*{box-sizing:border-box}body{margin:0;padding:48px 20px}main{max-width:570px;margin:5vh auto;background:white;border:1px solid #dce2da;border-radius:18px;padding:36px;box-shadow:0 12px 45px #18251f09}.brand{font-size:13px;font-weight:650;letter-spacing:.08em;color:#50715b}h1{font-size:29px;line-height:1.25;margin:18px 0}p,li{font-size:16px;line-height:1.65}code{overflow-wrap:anywhere;font-size:13px}.account{padding:14px 16px;background:#f3f6f1;border-radius:8px;overflow-wrap:anywhere}small{color:#55645b;line-height:1.6;display:block}.actions{display:flex;gap:12px;margin-top:28px}button{font:inherit;font-weight:600;border:1px solid #c8d3ca;border-radius:9px;padding:12px 20px;cursor:pointer;background:#fff;color:#22362b}button.primary{background:#285840;color:white;border-color:#285840}button:focus-visible{outline:3px solid #82b59a;outline-offset:3px}a{color:#285840}@media(max-width:480px){body{padding:20px 12px}main{padding:24px}.actions{flex-direction:column}h1{font-size:25px}}
  </style></head><body><main><div class="brand">JAPANESE WRITING</div><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, { status, headers: privateHeaders({ 'Content-Type': 'text/html; charset=utf-8' }) });
}

export function cookieName(env: Env): string { return appOrigin(env).startsWith('https:') ? '__Host-jw_flow' : 'jw_flow'; }

export function flowCookie(env: Env, value: string, clear = false): string {
  return `${cookieName(env)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 600}${appOrigin(env).startsWith('https:') ? '; Secure' : ''}`;
}

export function readFlowCookie(request: Request, env: Env): string {
  const entries = (request.headers.get('Cookie') ?? '').split(';').map(value => value.trim());
  const prefix = `${cookieName(env)}=`;
  const matches = entries.filter(value => value.startsWith(prefix));
  return matches.length === 1 ? matches[0].slice(prefix.length) : '';
}

export function redirect(location: string, cookie?: string): Response {
  const headers = privateHeaders({ Location: location });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}
