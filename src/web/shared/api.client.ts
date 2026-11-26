import type { ApiErrorBody } from "@/shared/dev.types";
import { id } from "@/web/i18n/id";
import { LOGIN_PATH } from "@/web/session/session.redirect";
import { reloadOnce } from "./chunk.error";

/** How an API call failed: no response, expired session, Cloudflare Access challenge, wrong role, other 4xx, or 5xx. */
export type ApiErrorKind = "network" | "unauthorized" | "access" | "forbidden" | "client" | "server";

/** Indonesian messages per server error code (`{ error: code }`), owned by each section. */
export type ErrorCodes = Readonly<Record<string, string>>;

/** Failure of an `/api/*` call; `code`/`serverMessage` come from the `{ error, message }` body when present. */
export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status: number | null,
    readonly code: string | null,
    readonly serverMessage: string | null,
    options?: ErrorOptions,
  ) {
    super(`api ${kind}${status ? ` HTTP ${status}` : ""}${code ? ` (${code})` : ""}`, options);
  }
}

const isErrorBody = (v: unknown): v is ApiErrorBody =>
  typeof v === "object" && v !== null && typeof (v as ApiErrorBody).error === "string";

/**
 * Sent on every `/api` call so Cloudflare Access answers an expired session with 401 instead of redirecting
 * the fetch to its login page on another domain (which surfaces as a network error).
 * Source: cloudflare-docs session-management.mdx, section "AJAX".
 */
export const AJAX_HEADERS = { accept: "application/json", "x-requested-with": "XMLHttpRequest" } as const;

/**
 * True when a 401 came from Cloudflare Access rather than the panel. The panel's own 401 is always JSON
 * `{ error: "unauthorized" }`; Access documents only the status, so any 401 without a `{ error }` JSON body is Access.
 */
export const isAccessChallenge = (status: number, body: unknown): boolean => status === 401 && !isErrorBody(body);

/** Maps a non-2xx status and its parsed body (or null) to an ApiError. */
export function errorFromResponse(status: number, body: unknown): ApiError {
  const kind: ApiErrorKind = isAccessChallenge(status, body)
    ? "access"
    : status === 401
      ? "unauthorized"
      : status === 403
        ? "forbidden"
        : status >= 500
          ? "server"
          : "client";
  const code = isErrorBody(body) ? body.error : null;
  const msg = isErrorBody(body) && typeof body.message === "string" ? body.message : null;
  return new ApiError(kind, status, code, msg);
}

/**
 * Where the browser must go after this error, or null. 401 and 403 both go to `/login`, which sends a signed-in
 * user on to `homeFor(role)` with the current role (DECISIONS B20); `/` is the public landing and would strand them.
 */
export function redirectFor(err: ApiError): string | null {
  return err.kind === "unauthorized" || err.kind === "forbidden" ? LOGIN_PATH : null;
}

/** sessionStorage key of the last Access-401 reload (loop guard shared with chunk reloads, see `reloadOnce`). */
const ACCESS_RELOAD_KEY = "panel.accessReloadAt";

/** Turns a failed response into an ApiError and performs its navigation (Access reload, or login). */
export function failedResponse(status: number, body: unknown): ApiError {
  const err = errorFromResponse(status, body);
  // Full page load so Access can show its login; refused (error state shown) when we just reloaded.
  if (err.kind === "access") reloadOnce(ACCESS_RELOAD_KEY);
  const to = redirectFor(err);
  if (to) window.location.assign(to);
  return err;
}

/** User-facing Indonesian message: known error code first, then server message for 4xx, then per kind. */
export function apiErrorMessage(err: unknown, codes: ErrorCodes = {}): string {
  if (!(err instanceof ApiError)) return id.common.errors.generic;
  const known = err.code ? codes[err.code] : undefined;
  if (known) return known;
  if (err.kind === "client") return err.serverMessage ?? id.common.errors.generic;
  return id.common.errors[err.kind];
}

/** Query value; empty strings, null and undefined are dropped. */
type QueryValue = string | number | boolean | null | undefined;

/** Builds `<base><path>?<query>`, skipping empty params. */
export function apiUrl(base: string, path: string, query: Record<string, QueryValue> = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  const s = qs.toString();
  return `${base}${path}${s ? `?${s}` : ""}`;
}

/**
 * Calls the API and returns the parsed JSON (undefined for 204). Throws ApiError; an aborted request
 * rethrows the AbortError untouched. 401/403 also navigate to `/login` (full load so the session and role are re-checked);
 * an Access 401 reloads the current URL (see `failedResponse`).
 */
export async function apiFetch<T>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      credentials: "same-origin",
      headers: { ...AJAX_HEADERS, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiError("network", null, null, null, { cause });
  }
  if (res.status === 204) return undefined as T;
  const parsed: unknown = await res.json().catch(() => null); // non-JSON body (proxy page) → treated as no body
  if (res.ok) {
    if (parsed === null) throw new ApiError("server", res.status, "invalid_json", null);
    return parsed as T;
  }
  throw failedResponse(res.status, parsed);
}
