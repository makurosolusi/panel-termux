// The API error type and request headers, apart from api.client.ts so the landing (`/`) and the session screens
// carry them without the fetch helpers and their error copy (PLAN/01 §3.11, bundle budget E6).

/** How an API call failed: no response, expired session, Cloudflare Access challenge, wrong role, other 4xx, or 5xx. */
export type ApiErrorKind = "network" | "unauthorized" | "access" | "forbidden" | "client" | "server";

/** Failure of an `/api/*` call; `code`/`serverMessage`/`reason` come from the `{ error, message, reason }` body. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number | null,
    readonly code: string | null,
    readonly serverMessage: string | null,
    options?: ErrorOptions,
    /** Machine-readable sub-code, e.g. why a 422 `not_fixable` cannot be fixed. */
    readonly reason: string | null = null,
  ) {
    super(`api ${kind}${status ? ` HTTP ${status}` : ""}${code ? ` (${code})` : ""}`, options);
  }
}

/**
 * Sent on every `/api` call so Cloudflare Access answers an expired session with 401 instead of redirecting
 * the fetch to its login page on another domain (which surfaces as a network error).
 * Source: cloudflare-docs session-management.mdx, section "AJAX".
 */
export const AJAX_HEADERS = { accept: "application/json", "x-requested-with": "XMLHttpRequest" } as const;
