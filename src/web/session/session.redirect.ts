import { canAccess, homeFor, isProtectedPath } from "@/shared/roles";
import type { MeResult } from "./session.api";

/** Sign-in route; signed-in visitors are sent home from here. */
export const LOGIN_PATH = "/login";

/** Public marketing landing page, open to everyone and never redirected. */
export const LANDING_PATH = "/";

/**
 * Where the SPA must send the visitor for `path`, or null to stay. UX only — the server enforces access. Guests go
 * to /login only from a signed-in area; on `/`, `/login` and unknown paths (public 404, DECISIONS A7) they stay.
 * Uses `homeFor(role)` rather than `me.home` so the client cannot be steered off-panel by a bad payload.
 */
export function resolveRedirect(result: MeResult, path: string): string | null {
  if (path === LANDING_PATH) return null;
  if (result.status === "unauthorized") return isProtectedPath(path) ? LOGIN_PATH : null;
  const home = homeFor(result.me.role);
  if (path === LOGIN_PATH) return home;
  return canAccess(result.me.role, path) ? null : home;
}

/**
 * Whether the redirect `path` → `to` must be a full document load: leaving the public /login for a protected home
 * lets Cloudflare Access challenge the document request (it cannot challenge a client-side navigation).
 * Never true for a redirect back to /login, so it cannot reload-loop.
 */
export const needsFullLoad = (path: string, to: string): boolean => path === LOGIN_PATH && to !== LOGIN_PATH;

/** Which 404 an unknown path shows: guests get the public page (A7), signed-in users the one inside the shell. */
export const notFoundKind = (result: MeResult): "public" | "shell" => (result.status === "ok" ? "shell" : "public");
