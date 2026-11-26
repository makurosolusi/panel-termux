import { Elysia } from "elysia";
import { hasRole, isRole, type Role } from "../../shared/roles";
import type { Auth } from "./auth.service";

/** Authenticated user as seen by API handlers. */
export type SessionUser = { id: string; email: string; name: string; image: string | null; role: Role };

/** Reads the Better Auth session from request cookies; null when not signed in. */
export async function getSessionUser(auth: Auth, headers: Headers): Promise<SessionUser | null> {
  const s = await auth.api.getSession({ headers });
  if (!s) return null;
  const { id, email, name, image, role } = s.user;
  return { id, email, name, image: image ?? null, role: isRole(role) ? role : "user" };
}

/**
 * Elysia group at `prefix` whose every route requires role ≥ `min`:
 * 401 `{ error: "unauthorized" }` without session, 403 `{ error: "forbidden" }` with a lower role.
 * Handlers get `user` in context. Register all routes of a protected area on this group.
 */
export const roleGuard = (auth: Auth, prefix: string, min: Role) =>
  new Elysia({ prefix }).resolve(async ({ request, status }) => {
    const user = await getSessionUser(auth, request.headers);
    if (!user) return status(401, { error: "unauthorized" });
    if (!hasRole(user.role, min)) return status(403, { error: "forbidden" });
    return { user };
  });
