import type { Role } from "./roles";

// Types of the signed-in user's own API under /api/me. Dates are ISO-8601 strings.

/** GET /api/me */
export type Me = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: Role;
  home: string;
  createdAt: string;
};

/**
 * Item of GET /api/me/sessions, which returns `MeSession[]` (active sessions, newest first). `userAgent` = short "Browser on OS"
 * (null when unknown); `ipMasked` hides the host part (null when not recorded). Tokens are never returned.
 */
export type MeSession = {
  id: string;
  current: boolean;
  createdAt: string;
  lastActiveAt: string;
  userAgent: string | null;
  ipMasked: string | null;
};

/** POST /api/me/sessions/revoke-others → number of sessions ended. DELETE /api/me/sessions/:id → 204. */
export type MeRevokeOthers = { revoked: number };
