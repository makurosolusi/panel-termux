import { log } from "../log.service";

const MINUTE_MS = 60_000;
const ERROR_WINDOW_MS = 5 * MINUTE_MS;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
/** Answers without a session that only repeat noise (probes, scanners, foreign origins, wrong host): debug (K16). */
const QUIET_ANON_STATUSES = new Set([401, 403, 404, 421]);
/** Probe endpoints polled by runit/install scripts: logged at debug so they don't drown real traffic. */
const QUIET_PATHS = new Set(["/api/health", "/api/ready"]);

// ponytail: one timestamp per request, pruned per window; switch to per-second buckets if traffic ever grows.
const requests: number[] = [];
const errors: number[] = [];
const unhandled: number[] = [];

const prune = (a: number[], cutoff: number) => {
  while (a.length && (a[0] as number) < cutoff) a.shift();
};

/** One finished API request as the logger sees it. `path` must be a pathname (never the query string). */
export type RequestRecord = { method: string; path: string; status: number; ms: number; userId: string | null };

/** Formats the log line `METHOD path status ms [user=id]` (no query, no PII). */
export const requestLine = ({ method, path, status, ms, userId }: RequestRecord): string =>
  `[http] ${method} ${path} ${status} ${Math.round(ms)}ms${userId ? ` user=${userId}` : ""}`;

/**
 * Level of a request line (PLAN/02 K16, flash wear): successful reads, probes and anonymous 401/403/404/421 (the
 * CSRF `forbidden_origin` and wrong-host answers come before any session) → debug; 5xx → warn; the rest → info.
 */
export function requestLevel({ method, path, status, userId }: RequestRecord): "debug" | "info" | "warn" {
  if (status >= HTTP_SERVER_ERROR) return "warn";
  if (QUIET_PATHS.has(path)) return "debug";
  if ((method === "GET" || method === "HEAD") && status < HTTP_BAD_REQUEST) return "debug";
  return userId === null && QUIET_ANON_STATUSES.has(status) ? "debug" : "info";
}

/** Logs one API request at requestLevel and counts it for /api/dev/health. */
export function logRequest(r: RequestRecord, now = Date.now()): void {
  requests.push(now);
  prune(requests, now - MINUTE_MS);
  if (r.status >= HTTP_SERVER_ERROR) {
    errors.push(now);
    prune(errors, now - ERROR_WINDOW_MS);
  }
  if (r.status === HTTP_SERVER_ERROR) {
    unhandled.push(now);
    prune(unhandled, now - ERROR_WINDOW_MS);
  }
  log[requestLevel(r)](requestLine(r));
}

/** Requests in the last minute, 5xx in the last 5 minutes, and exactly-500 (unhandled) in the last 5 minutes. */
export function requestStats(now = Date.now()): {
  requestsPerMinute: number;
  errorCount5m: number;
  unhandled5m: number;
} {
  prune(requests, now - MINUTE_MS);
  prune(errors, now - ERROR_WINDOW_MS);
  prune(unhandled, now - ERROR_WINDOW_MS);
  return { requestsPerMinute: requests.length, errorCount5m: errors.length, unhandled5m: unhandled.length };
}
