import { createHash } from "node:crypto";

/** Google account avatars shown in the shell/profile. */
const AVATAR_ORIGIN = "https://lh3.googleusercontent.com";
/** OAuth consent screen (sign-in redirects there). */
const GOOGLE_ACCOUNTS_ORIGIN = "https://accounts.google.com";
const HSTS_MAX_AGE_SEC = 15_552_000; // 180 days

/** JSON API responses never render anything. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** Inline `<script>` bodies (no src) of an HTML document, as CSP `'sha256-…'` sources. */
export function inlineScriptHashes(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1] ?? "";
    if (body.trim()) out.push(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
  return out;
}

/**
 * CSP of an SPA page. Inline scripts (e.g. the pre-paint theme script in index.html) are allowed by hash,
 * never 'unsafe-inline'. style-src keeps 'unsafe-inline': Radix (scroll lock) and sonner inject <style>
 * elements at runtime. `development` relaxes scripts/connect for Bun's HMR client and websocket.
 */
export function pageCsp(html: string, development: boolean): string {
  const scripts = development ? ["'unsafe-inline'", "'unsafe-eval'"] : inlineScriptHashes(html);
  return [
    "default-src 'self'",
    `script-src 'self' ${scripts.join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${AVATAR_ORIGIN}`,
    "font-src 'self' data:",
    development ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action 'self' ${GOOGLE_ACCOUNTS_ORIGIN}`,
  ].join("; ");
}

/** Sets the security headers on `headers` (in place). HSTS only when the public origin is https. */
export function applySecurityHeaders(headers: Headers, csp: string, https: boolean): Headers {
  headers.set("content-security-policy", csp);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("x-frame-options", "DENY");
  if (https) headers.set("strict-transport-security", `max-age=${HSTS_MAX_AGE_SEC}; includeSubDomains`);
  return headers;
}
