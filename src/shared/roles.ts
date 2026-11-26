/** Panel role, ordered from least to most privileged. */
export type Role = "user" | "admin" | "super_admin";

/** All roles, least privileged first. */
export const ROLES: readonly Role[] = ["user", "admin", "super_admin"];

const HOME: Record<Role, string> = { user: "/profile", admin: "/panel", super_admin: "/dev" };

/** Minimum role required per protected path prefix. */
const AREA_MIN_ROLE: Record<string, Role> = { "/profile": "user", "/panel": "admin", "/dev": "super_admin" };

/** Landing page for a role after login. */
export const homeFor = (role: Role): string => HOME[role];

/** Whether `role` may open `path`. Unprotected paths (e.g. /login) are allowed for everyone. */
export function canAccess(role: Role, path: string): boolean {
  const area = Object.keys(AREA_MIN_ROLE).find((p) => path === p || path.startsWith(`${p}/`));
  if (!area) return true;
  return ROLES.indexOf(role) >= ROLES.indexOf(AREA_MIN_ROLE[area] as Role);
}
