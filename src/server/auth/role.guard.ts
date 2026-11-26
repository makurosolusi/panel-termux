import { Elysia } from "elysia";
import { hasRole, isRole, type Role } from "../../shared/roles";
import { log } from "../log.service";
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

/** Absolute session lifetime from sign-in, however active the session stays (PLAN/04 K14). */
export const SESSION_ABSOLUTE_MAX_DAYS = 30;
const SESSION_ABSOLUTE_MAX_MS = SESSION_ABSOLUTE_MAX_DAYS * 86_400_000;

/** Throws ApiError 403 `reauth_required` when the session was created more than FRESH_SESSION_MS before `now`. */
export function assertFresh(session: { createdAt: Date }, now: Date = new Date()): void {
  if (now.getTime() - session.createdAt.getTime() > FRESH_SESSION_MS)
    throw new ApiError(403, "reauth_required", "sign in again to change this setting");
}

/** Better Auth's session as returned by getSession. */
export type SessionWithUser = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

/**
 * getSession plus the absolute-age check: a session created more than SESSION_ABSOLUTE_MAX_DAYS ago is
 * deleted and treated as signed out. Every authenticated path (role guard, /me, sessions) goes through here.
 */
export async function getSessionChecked(
  auth: Auth,
  headers: Headers,
  now: Date = new Date(),
): Promise<SessionWithUser | null> {
  const s = await auth.api.getSession({ headers });
  if (!s) return null;
  if (now.getTime() - new Date(s.session.createdAt).getTime() <= SESSION_ABSOLUTE_MAX_MS) return s;
  await (await auth.$context).internalAdapter.deleteSession(s.session.token);
  log.info(
    `[auth] session ${s.session.id} of user ${s.user.id} expired (older than ${SESSION_ABSOLUTE_MAX_DAYS} days)`,
  );
  return null;
}

async function readSession(auth: Auth, headers: Headers): Promise<{ user: SessionUser; session: SessionRef } | null> {
  const s = await getSessionChecked(auth, headers);
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
