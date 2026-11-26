import { createRateLimiter } from "../http/rate.limit";
import { log } from "../log.service";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Better Auth checks origin on its own endpoints (trustedOrigins = baseURL); not ours to second-guess. */
const AUTH_PREFIX = "/api/auth/";
/** Suppressed-count map is dropped past this many origin hosts (Origin is attacker-chosen). */
const MAX_TRACKED_HOSTS = 10_000;

// One `[csrf]` line per origin host per minute (a hostile page can POST thousands of times a minute to flash).
const logLimit = createRateLimiter(1);
const suppressed = new Map<string, number>();

/** Logs a rejection unless this origin host was already logged this minute; the next line carries the count. */
function logRejection(method: string, path: string, origin: string | null, fetchSite: string | null): void {
  const host = originHost(origin);
  if (logLimit.take(host) !== null) {
    if (suppressed.size > MAX_TRACKED_HOSTS) suppressed.clear(); // ponytail: counts lost under a host flood
    suppressed.set(host, (suppressed.get(host) ?? 0) + 1);
    return;
  }
  const n = suppressed.get(host) ?? 0;
  suppressed.delete(host);
  const more = n ? ` (+${n} suppressed)` : "";
  log.warn(`[csrf] rejected ${method} ${path} origin=${host} fetch-site=${fetchSite ?? "-"}${more}`);
}

/**
 * CSRF guard for state-changing /api requests: 403 `{ error: "forbidden_origin" }` unless the request
 * comes from the panel's own pages, else null. Needed because SameSite=Lax cookies are still sent by
 * pages on sibling subdomains (sites the panel hosts are "same-site"). Rules, all must hold:
 * - `Sec-Fetch-Site`, when sent, is `same-origin` (same-site/cross-site/none are rejected);
 * - `Origin`, when sent, equals the APP_BASE_URL origin;
 * - `X-Requested-With: XMLHttpRequest` is present: a custom header forces a CORS preflight that the
 *   panel never answers, so another origin cannot send it; this also covers clients without Origin.
 * GET/HEAD pass untouched (they must not mutate). Called first in createApiHandler (before rate limits).
 */
export function rejectForeignOrigin(req: Request, appBaseUrl: string): Response | null {
  if (!MUTATING.has(req.method)) return null;
  const path = new URL(req.url).pathname;
  if (path.startsWith(AUTH_PREFIX)) return null;

  const h = req.headers;
  const fetchSite = h.get("sec-fetch-site");
  const origin = h.get("origin");
  const ok =
    (fetchSite === null || fetchSite === "same-origin") &&
    (origin === null || origin === new URL(appBaseUrl).origin) &&
    h.get("x-requested-with") === "XMLHttpRequest";
  if (ok) return null;

  logRejection(req.method, path, origin, fetchSite);
  return Response.json(
    { error: "forbidden_origin", message: "state-changing requests are only accepted from the panel's own pages" },
    { status: 403 },
  );
}

/** Host part of an Origin header for logs ("-" when absent, "invalid" when unparsable, e.g. "null"). */
const originHost = (origin: string | null): string => {
  if (origin === null) return "-";
  try {
    return new URL(origin).host || "invalid";
  } catch {
    return "invalid"; // logging only: a malformed Origin is itself the reason for the rejection
  }
};
