import type { Locale } from "./locale";
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
  /** Chosen UI language; null = follow the device (DECISIONS E2). */
  locale: Locale | null;
};

/** PATCH /api/me body → 204. Only `locale` is editable; null = follow the device. 400 `invalid_locale` otherwise. */
export type MePatch = { locale: Locale | null };

/**
 * Item of GET /api/me/sessions, which returns `MeSession[]` (active sessions, newest first). `userAgent` = locale-neutral
 * "Browser · OS" (null when unknown); `ipMasked` hides the host part (null when not recorded). Tokens are never returned.
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
