import type { Me } from "@/shared/me.types";
import { AJAX_HEADERS, ApiError } from "@/web/shared/api.error";

/** Signed-in account as returned by `GET /api/me` (re-exported from the shared contract). */
export type { Me };

/** Outcome of the session check; network/server failures are thrown, not returned. */
export type MeResult = { status: "ok"; me: Me } | { status: "unauthorized" };

/**
 * Loads the current session. Throws `ApiError("network")` when the server is unreachable and `ApiError("server",
 * status)` on any other non-401 failure, so SessionError can tell the two apart.
 */
export async function fetchMe(): Promise<MeResult> {
  const res = await fetch("/api/me", { credentials: "same-origin", headers: AJAX_HEADERS }).catch((cause: unknown) => {
    throw new ApiError("network", null, null, null, { cause });
  });
  if (res.status === 401) return { status: "unauthorized" };
  if (!res.ok) throw new ApiError("server", res.status, null, null);
  return { status: "ok", me: (await res.json()) as Me };
}
