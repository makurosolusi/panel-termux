import { log } from "../log.service";

const MINUTE_MS = 60_000;
const ERROR_WINDOW_MS = 5 * MINUTE_MS;
const HTTP_SERVER_ERROR = 500;
/** Probe endpoints polled by runit/install scripts: logged at debug so they don't drown real traffic. */
const QUIET_PATHS = new Set(["/api/health", "/api/ready"]);

// ponytail: one timestamp per request, pruned per window; switch to per-second buckets if traffic ever grows.
const requests: number[] = [];
const errors: number[] = [];

const prune = (a: number[], cutoff: number) => {
  while (a.length && (a[0] as number) < cutoff) a.shift();
};

/** One finished API request as the logger sees it. `path` must be a pathname (never the query string). */
export type RequestRecord = { method: string; path: string; status: number; ms: number; userId: string | null };

/** Formats the log line `METHOD path status ms [user=id]` (no query, no PII). */
export const requestLine = ({ method, path, status, ms, userId }: RequestRecord): string =>
  `[http] ${method} ${path} ${status} ${Math.round(ms)}ms${userId ? ` user=${userId}` : ""}`;

/** Logs one API request (info; debug for probes) and counts it for /api/dev/health. */
export function logRequest(r: RequestRecord, now = Date.now()): void {
  requests.push(now);
  prune(requests, now - MINUTE_MS);
  if (r.status >= HTTP_SERVER_ERROR) {
    errors.push(now);
    prune(errors, now - ERROR_WINDOW_MS);
  }
  if (QUIET_PATHS.has(r.path)) log.debug(requestLine(r));
  else log.info(requestLine(r));
}

/** Requests in the last minute and 5xx responses in the last 5 minutes. */
export function requestStats(now = Date.now()): { requestsPerMinute: number; errorCount5m: number } {
  prune(requests, now - MINUTE_MS);
  prune(errors, now - ERROR_WINDOW_MS);
  return { requestsPerMinute: requests.length, errorCount5m: errors.length };
}
