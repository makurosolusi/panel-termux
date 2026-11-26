import { Elysia } from "elysia";
import { hasRole, isRole, type Role } from "../../shared/roles";
import { ApiError } from "../routes/http.error";
import type { Auth } from "./auth.service";

/** Authenticated user as seen by API handlers. */
export type SessionUser = { id: string; email: string; name: string; image: string | null; role: Role };

/** Signed-in user id per request headers object, so the request logger can name the user afterwards. */
export const requestUserIds = new WeakMap<Headers, string>();

/** The current session as handlers need it (freshness checks, "this device"). */
export type SessionRef = { id: string; createdAt: Date };

/** How long after sign-in a session counts as fresh for sensitive changes (PLAN/04 §3.5). */
export const FRESH_SESSION_MS = 15 * 60_000;

/** Throws ApiError 403 `reauth_required` when the session was created more than FRESH_SESSION_MS before `now`. */
export function assertFresh(session: { createdAt: Date }, now: Date = new Date()): void {
  // Stub per PLAN/04 §3.7; wkr-audit-02 (W2) owns the final version alongside getSessionChecked.
  if (now.getTime() - session.createdAt.getTime() > FRESH_SESSION_MS)
    throw new ApiError(403, "reauth_required", "sign in again to change this setting");
}

async function readSession(auth: Auth, headers: Headers): Promise<{ user: SessionUser; session: SessionRef } | null> {
  const s = await auth.api.getSession({ headers });
  if (!s) return null;
  const { id, email, name, image, role } = s.user;
  requestUserIds.set(headers, id);
  return {
    user: { id, email, name, image: image ?? null, role: isRole(role) ? role : "user" },
    session: { id: s.session.id, createdAt: new Date(s.session.createdAt) },
  };
}

/** Reads the Better Auth session from request cookies; null when not signed in. */
export async function getSessionUser(auth: Auth, headers: Headers): Promise<SessionUser | null> {
  return (await readSession(auth, headers))?.user ?? null;
}

/**
 * Elysia group at `prefix` whose every route requires role ≥ `min`:
 * 401 `{ error: "unauthorized" }` without session, 403 `{ error: "forbidden" }` with a lower role.
 * Handlers get `user` and `session` in context. Register all routes of a protected area on this group.
 */
export const roleGuard = (auth: Auth, prefix: string, min: Role) =>
  new Elysia({ prefix }).resolve(async ({ request, status }) => {
    const s = await readSession(auth, request.headers);
    if (!s) return status(401, { error: "unauthorized" });
    if (!hasRole(s.user.role, min)) return status(403, { error: "forbidden" });
    return s;
  });
