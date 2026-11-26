import { requestUserIds } from "../auth/role.guard";
import { maskIp, shortUserAgent } from "../auth/sessions.service";
import { log } from "../log.service";
import { rejectForeignOrigin } from "../routes/origin.guard";
import { AUTH_LIMIT_PER_IP, clientIp, createRateLimiter, MUTATION_LIMIT_PER_SESSION } from "./rate.limit";
import { runWithRequest } from "./request.context";
import { logRequest } from "./request.log";
import { API_CSP, applySecurityHeaders } from "./security.headers";

/** Largest non-upload request body (JSON endpoints). */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;
const HTTP_TOO_MANY = 429;
const HTTP_TOO_LARGE = 413;
const HTTP_INTERNAL = 500;
const HTTP_CLIENT_ERROR = 400;
const HTTP_MISDIRECTED = 421;
const ERROR_LOG_SNIPPET = 300;

/** Binary deploy chunks: own size check (DEPLOY_CHUNK_SIZE) and exempt from the mutation limit. */
const CHUNK_ROUTE = /^\/api\/panel\/uploads\/[^/]+\/chunks\/\d+$/;
const AUTH_LIMITED = /^\/api\/auth\/(sign-in|callback)\//;
const MUTATION_AREA = /^\/api\/(panel|dev|me)\//;
/** Areas where an authenticated request carrying a Cloudflare Access JWT proves Access is in front. */
const ACCESS_AREA = /^\/api\/(panel|dev)\//;
const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
/** Hosts the installer, probes and local dev use; always accepted besides the APP_BASE_URL host. */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/;

/** Default `{ error, message }` for bodies that are not already JSON errors. */
const STATUS_ERRORS: Record<number, [string, string]> = {
  400: ["bad_request", "bad request"],
  401: ["unauthorized", "sign in required"],
  403: ["forbidden", "not allowed for your role"],
  404: ["not_found", "not found"],
  405: ["method_not_allowed", "method not allowed"],
  409: ["conflict", "conflict"],
  413: ["payload_too_large", "request body too large"],
  429: ["rate_limited", "too many requests"],
};
const defaultError = (status: number): [string, string] =>
  STATUS_ERRORS[status] ?? [`http_${status}`, `request failed with HTTP ${status}`];

/** JSON error response with the uniform `{ error, message }` body. */
export function errorResponse(status: number, body: Record<string, unknown>, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json");
  h.delete("content-length");
  return new Response(JSON.stringify(body), { status, headers: h });
}

/** Rewrites a 4xx/5xx into `{ error, message }` (keeping extra fields); 500 bodies are replaced (logged). */
async function normalizeError(res: Response, requestId: string): Promise<Response> {
  const text = await res.text();
  if (res.status === HTTP_INTERNAL) {
    log.error(`[http] ${requestId} internal error: ${text.slice(0, ERROR_LOG_SNIPPET)}`);
    const message = `internal error (request id ${requestId})`;
    return errorResponse(res.status, { error: "internal_error", message, requestId }, res.headers);
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON body (e.g. Elysia's plain "NOT_FOUND"): replaced by the status default below.
  }
  const [code, message] = defaultError(res.status);
  const obj =
    typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const fromCode = typeof obj.code === "string" ? obj.code.toLowerCase() : undefined; // Better Auth errors
  return errorResponse(
    res.status,
    {
      ...obj,
      error: typeof obj.error === "string" ? obj.error : (fromCode ?? code),
      message: typeof obj.message === "string" && obj.message ? obj.message : message,
    },
    res.headers,
  );
}

/** Reads at most `max` bytes of the body; null when it is larger. */
async function readCapped(req: Request, max: number): Promise<Blob | null> {
  const parts: BlobPart[] = [];
  let size = 0;
  for await (const chunk of req.body as ReadableStream<Uint8Array>) {
    size += chunk.byteLength;
    if (size > max) return null;
    parts.push(chunk as Uint8Array<ArrayBuffer>);
  }
  return new Blob(parts);
}

/**
 * Last time an authenticated /api/panel or /api/dev request came through Cloudflare Access. Single source
 * for onboarding/health; display only, never used for authorization.
 */
export const accessSeen: { at: Date | null } = { at: null };

type Handler = { handle(req: Request): Response | Promise<Response> };
type Peer = { requestIP(req: Request): { address: string } | null } | undefined;

/**
 * Wraps the API with the cross-cutting HTTP rules, in order: host check (421 `wrong_host`) → CSRF origin
 * guard (403, before the rate limit so foreign pages cannot burn a session's quota) → rate limits → JSON
 * body limit → handler inside the request context. Plus uniform error bodies (500 → request id, no stack),
 * security headers, `cache-control: no-store`, one log line per request and `accessSeen`.
 */
export function createApiHandler(api: Handler, { appBaseUrl }: { appBaseUrl: string }) {
  const base = new URL(appBaseUrl);
  const https = base.protocol === "https:";
  const authLimit = createRateLimiter(AUTH_LIMIT_PER_IP);
  const mutationLimit = createRateLimiter(MUTATION_LIMIT_PER_SESSION);

  async function respond(req: Request, url: URL, ip: string, requestId: string): Promise<Response> {
    const path = url.pathname;
    // A second ingress pointed at the panel port must not bypass Access: only our own host or loopback.
    if (url.host !== base.host && !LOOPBACK_HOSTS.has(url.hostname))
      return errorResponse(HTTP_MISDIRECTED, { error: "wrong_host", message: `host ${url.host} is not served here` });
    const foreign = rejectForeignOrigin(req, appBaseUrl);
    if (foreign) return foreign;

    const chunk = CHUNK_ROUTE.test(path);
    let retry: number | null = null;
    if (AUTH_LIMITED.test(path)) retry = authLimit.take(ip);
    else if (!SAFE_METHODS.has(req.method) && MUTATION_AREA.test(path) && !chunk) {
      const token = req.headers.get("cookie")?.match(SESSION_COOKIE)?.[1];
      retry = mutationLimit.take(token ? `s:${Bun.hash(token)}` : `ip:${ip}`);
    }
    if (retry !== null) {
      const message = `too many requests; retry in ${retry} s`;
      return errorResponse(HTTP_TOO_MANY, { error: "rate_limited", message }, { "retry-after": String(retry) });
    }

    let forward = req;
    if (req.body && !chunk) {
      const tooLarge = () =>
        errorResponse(HTTP_TOO_LARGE, {
          error: "payload_too_large",
          message: `request body larger than ${MAX_JSON_BODY_BYTES} bytes`,
        });
      const len = req.headers.get("content-length");
      if (len !== null) {
        if (Number(len) > MAX_JSON_BODY_BYTES) return tooLarge();
      } else {
        const body = await readCapped(req, MAX_JSON_BODY_BYTES);
        if (body === null) return tooLarge();
        forward = new Request(req.url, { method: req.method, headers: req.headers, body });
      }
    }

    try {
      const ctx = { requestId, ipMasked: maskIp(ip), userAgent: shortUserAgent(req.headers.get("user-agent")) };
      const res = await runWithRequest(ctx, () => api.handle(forward));
      return res.status >= HTTP_CLIENT_ERROR ? await normalizeError(res, requestId) : res;
    } catch (e) {
      log.error(`[http] ${requestId} ${req.method} ${path} threw: ${e instanceof Error ? e.message : String(e)}`);
      const message = `internal error (request id ${requestId})`;
      return errorResponse(HTTP_INTERNAL, { error: "internal_error", message, requestId });
    } finally {
      const userId = requestUserIds.get(forward.headers);
      if (userId) requestUserIds.set(req.headers, userId);
      if (userId && ACCESS_AREA.test(path) && req.headers.has(ACCESS_JWT_HEADER)) accessSeen.at = new Date();
    }
  }

  return async (req: Request, server?: Peer): Promise<Response> => {
    const t0 = performance.now();
    const requestId = crypto.randomUUID();
    const url = new URL(req.url);
    const path = url.pathname;
    const ip = clientIp(req.headers, server?.requestIP(req)?.address ?? null);
    const raw = await respond(req, url, ip, requestId);
    // Fresh Response: handler/fetch responses may carry immutable headers.
    const headers = applySecurityHeaders(new Headers(raw.headers), API_CSP, https);
    headers.set("x-request-id", requestId);
    headers.set("cache-control", "no-store");
    const res = new Response(raw.body, { status: raw.status, statusText: raw.statusText, headers });
    const userId = requestUserIds.get(req.headers) ?? null;
    logRequest({ method: req.method, path, status: res.status, ms: performance.now() - t0, userId });
    return res;
  };
}
