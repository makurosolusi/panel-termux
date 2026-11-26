import type { Role } from "@/shared/roles";
import { AJAX_HEADERS, ApiError } from "@/web/shared/api.client";

/** Signed-in account as returned by `GET /api/me`. */
export type Me = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  home: string;
};

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
