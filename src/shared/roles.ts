/** Panel role, ordered from least to most privileged. */
export type Role = "user" | "admin" | "super_admin";

/** All roles, least privileged first. */
export const ROLES: readonly Role[] = ["user", "admin", "super_admin"];

/** Home after login; super_admin lands on Ringkasan too (DECISIONS A11/B19), /dev stays in the nav. */
const HOME: Record<Role, string> = { user: "/profile", admin: "/panel", super_admin: "/panel" };

/** Minimum role required per protected path prefix. */
const AREA_MIN_ROLE: Record<string, Role> = { "/profile": "user", "/panel": "admin", "/dev": "super_admin" };

/** Top-level SPA routes; any other path is a public 404 (DECISIONS A7). "/" matches only itself. */
export const SPA_ROOTS: readonly string[] = ["/", "/login", "/profile", "/panel", "/dev"];

/** Whether `path` is `root` itself or below it (per path segment, so "/panelx" is not under "/panel"). */
const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);

/** Type guard: whether `v` is a known role (e.g. a value read from the DB). */
export const isRole = (v: unknown): v is Role => ROLES.includes(v as Role);

/** Whether `role` is at least as privileged as `min`. */
export const hasRole = (role: Role, min: Role): boolean => ROLES.indexOf(role) >= ROLES.indexOf(min);

/** Landing page for a role after login. */
export const homeFor = (role: Role): string => HOME[role];

/** Whether `path` lies in a signed-in area (guests are sent to /login there). */
export const isProtectedPath = (path: string): boolean => Object.keys(AREA_MIN_ROLE).some((p) => under(path, p));

/** Whether the SPA has a route tree for `path`; false → the server answers 404 (+ noindex). */
export const isKnownSpaPath = (path: string): boolean =>
  SPA_ROOTS.some((root) => (root === "/" ? path === "/" : under(path, root)));

/** Whether `role` may open `path`. Unprotected paths (e.g. /login) are allowed for everyone. */
export function canAccess(role: Role, path: string): boolean {
  const area = Object.keys(AREA_MIN_ROLE).find((p) => under(path, p));
  if (!area) return true;
  return hasRole(role, AREA_MIN_ROLE[area] as Role);
}
