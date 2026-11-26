import { canAccess, homeFor } from "@/shared/roles";
import type { MeResult } from "./session.api";

/** Sign-in route; signed-in visitors are sent home from here. */
export const LOGIN_PATH = "/login";

/** Public marketing landing page, open to everyone and never redirected. */
export const LANDING_PATH = "/";

/**
 * Where the SPA must send the visitor for `path`, or null to stay. UX only — the server enforces access.
 * Uses `homeFor(role)` rather than `me.home` so the client cannot be steered off-panel by a bad payload.
 */
export function resolveRedirect(result: MeResult, path: string): string | null {
  if (path === LANDING_PATH) return null;
  if (result.status === "unauthorized") return path === LOGIN_PATH ? null : LOGIN_PATH;
  const home = homeFor(result.me.role);
  if (path === LOGIN_PATH) return home;
  return canAccess(result.me.role, path) ? null : home;
}
