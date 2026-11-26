import type { RevokedSessions, SecurityStatus } from "@/shared/security.types";
import { idSecurity } from "@/web/i18n/id.security";
import { AJAX_HEADERS, ApiError, apiFetch, failedResponse, REAUTH_REQUIRED } from "@/web/shared/api.client";

/** GET: data key state, Access, sessions (super_admin only; never call it for admins, a 403 navigates to /login). */
export const SECURITY_STATUS_URL = "/api/dev/security";

/** Security error codes → Indonesian messages. */
export const SECURITY_ERROR_CODES: Readonly<Record<string, string>> = idSecurity.errorCodes;

/** True when the error asks the user to sign in again (shown as a "Masuk ulang" action, not a toast). */
export const isReauthRequired = (err: unknown): boolean => err instanceof ApiError && err.code === REAUTH_REQUIRED;

/**
 * Fetch for fresh-session endpoints that need the raw response (blob downloads, or an opaque redirect when `redirect`
 * is "manual"). Errors follow apiFetch: a 403 `reauth_required` is thrown without navigating (see `redirectFor`).
 */
export async function sensitiveFetch(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  redirect: RequestRedirect = "follow",
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      redirect,
      credentials: "same-origin",
      headers: { ...AJAX_HEADERS, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError("network", null, null, null, { cause });
  }
  if (res.ok || res.type === "opaqueredirect") return res;
  const parsed: unknown = await res.json().catch(() => null); // non-JSON body (proxy page) → no code
  throw failedResponse(res.status, parsed);
}

/** `filename="…"` of a Content-Disposition header, or `fallback`. */
export function attachmentName(header: string | null, fallback: string): string {
  return header?.match(/filename="([^"]+)"/)?.[1] ?? fallback;
}

/** Fallback name of the data key file when the header is missing (the server always sends one). */
const DATA_KEY_FALLBACK_NAME = "panel-termux-kunci-data.txt";

/** POST data-key/export and saves the returned text file through a temporary object URL. */
export async function exportDataKey(): Promise<void> {
  const res = await sensitiveFetch("POST", `${SECURITY_STATUS_URL}/data-key/export`);
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = attachmentName(res.headers.get("content-disposition"), DATA_KEY_FALLBACK_NAME);
  a.click();
  URL.revokeObjectURL(href);
}

/** POST data-key/reset with the typed word; returns the new status. */
export async function resetDataKey(confirm: string): Promise<SecurityStatus> {
  const res = await sensitiveFetch("POST", `${SECURITY_STATUS_URL}/data-key/reset`, { confirm });
  return (await res.json()) as SecurityStatus;
}

/** POST /api/dev/sessions/revoke-all: ends every session except the caller's. */
export const revokeAllSessions = () => apiFetch<RevokedSessions>("POST", "/api/dev/sessions/revoke-all");

/**
 * Signs in with Google again (new, fresh session) and comes back to the current page and anchor. The auth client is
 * imported on demand: it reads `window` at load, which would break importing this module outside the browser.
 */
export async function reauthenticate(): Promise<void> {
  const { authClient } = await import("@/web/auth/auth.client");
  await authClient.signIn.social({
    provider: "google",
    callbackURL: `${window.location.pathname}${window.location.hash}`,
    errorCallbackURL: "/login",
  });
}
