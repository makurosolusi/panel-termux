import { canAccess, homeFor } from "@/shared/roles";
import type { MeResult } from "./session.api";

/** Public route; every other route requires a session. */
export const LOGIN_PATH = "/login";

/**
 * Where the SPA must send the visitor for `path`, or null to stay. UX only — the server enforces access.
 * Uses `homeFor(role)` rather than `me.home` so the client cannot be steered off-panel by a bad payload.
 */
export function resolveRedirect(result: MeResult, path: string): string | null {
  if (result.status === "unauthorized") return path === LOGIN_PATH ? null : LOGIN_PATH;
  const home = homeFor(result.me.role);
  if (path === "/" || path === LOGIN_PATH) return home;
  return canAccess(result.me.role, path) ? null : home;
}
