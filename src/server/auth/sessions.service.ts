import { and, desc, eq, gt, ne } from "drizzle-orm";
import { deviceLabel } from "../../shared/device.label";
import type { MeSession } from "../../shared/me.types";
import type { RevokedSessions } from "../../shared/security.types";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { session, user } from "../db/schema";
import { log } from "../log.service";
import { ApiError } from "../routes/http.error";
import type { Auth } from "./auth.service";
import { getSessionChecked, requestUserIds } from "./role.guard";

const BROWSERS: [RegExp, string][] = [
  [/EdgA?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
  [/curl\//, "curl"],
];
const SYSTEMS: [RegExp, string][] = [
  [/Android/, "Android"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/Linux/, "Linux"],
];

/**
 * Locale-neutral device label "Browser · OS" from a User-Agent (E10), null when it names neither; the UI renders
 * null in its own language. First match wins; order matters: Edge/Opera also say Chrome.
 */
export function shortUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  return deviceLabel(BROWSERS.find(([re]) => re.test(ua))?.[1], SYSTEMS.find(([re]) => re.test(ua))?.[1]);
}

/** IPv4 → last octet masked (`203.0.113.x`); IPv6 → first three groups (`2001:db8:1::/48`). */
export function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return `${v4.split(".").slice(0, 3).join(".")}.x`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  return null;
}

/** The signed-in user's own sessions behind /api/me/sessions. Tokens stay server-side. */
export function createSessionsService(auth: Auth, db: Db) {
  const current = async (headers: Headers) => {
    const s = await getSessionChecked(auth, headers);
    if (!s) throw new ApiError(401, "unauthorized", "sign in required");
    requestUserIds.set(headers, s.user.id);
    return s;
  };

  return {
    async list(headers: Headers): Promise<MeSession[]> {
      const me = await current(headers);
      const rows = db
        .select()
        .from(session)
        .where(and(eq(session.userId, me.user.id), gt(session.expiresAt, new Date())))
        .orderBy(desc(session.updatedAt))
        .all();
      return rows.map((r) => ({
        id: r.id,
        current: r.id === me.session.id,
        createdAt: r.createdAt.toISOString(),
        lastActiveAt: r.updatedAt.toISOString(),
        userAgent: shortUserAgent(r.userAgent),
        ipMasked: maskIp(r.ipAddress),
      }));
    },

    /** Ends one other session of the user; 400 for the current one (sign out instead), 404 for others' ids. */
    async revoke(headers: Headers, id: string): Promise<void> {
      const me = await current(headers);
      if (id === me.session.id)
        throw new ApiError(400, "current_session", "this is the current session; sign out instead");
      const row = db
        .select({ token: session.token })
        .from(session)
        .where(and(eq(session.id, id), eq(session.userId, me.user.id)))
        .get();
      if (!row) throw new ApiError(404, "not_found", `unknown session ${id}`);
      await auth.api.revokeSession({ headers, body: { token: row.token } });
      recordAudit(db, { actorId: me.user.id, action: "session.revoke", target: id, meta: { scope: "one" } });
      log.info(`[auth] user ${me.user.id} revoked session ${id}`);
    },

    /** Ends every session of the user except the current one. */
    async revokeOthers(headers: Headers): Promise<{ revoked: number }> {
      const me = await current(headers);
      const before = (await this.list(headers)).filter((s) => !s.current).length;
      await auth.api.revokeOtherSessions({ headers });
      recordAudit(db, {
        actorId: me.user.id,
        action: "session.revoke",
        target: me.user.id,
        meta: { scope: "others", count: before },
      });
      log.info(`[auth] user ${me.user.id} revoked ${before} other session(s)`);
      return { revoked: before };
    },
  };
}

/**
 * Signs user `userId` out everywhere (super_admin action, B6): any target except the caller (409 `self`),
 * env super admins included. Roles stay.
 */
export function revokeUserSessions(db: Db, actorId: string, userId: string): RevokedSessions {
  if (actorId === userId) throw new ApiError(409, "self", "use your own sessions page to sign out your devices");
  const target = db.select({ email: user.email }).from(user).where(eq(user.id, userId)).get();
  if (!target) throw new ApiError(404, "not_found", `unknown user ${userId}`);
  const revoked = db.delete(session).where(eq(session.userId, userId)).returning({ id: session.id }).all().length;
  // targetEmail names the user in the audit sentence, like user.role_change / user.delete (G27 retention)
  recordAudit(db, {
    actorId,
    action: "session.revoke",
    target: userId,
    meta: { scope: "user", userId, revoked, targetEmail: target.email },
  });
  log.info(`[auth] user ${actorId} revoked ${revoked} session(s) of user ${userId}`);
  return { revoked };
}

/** "Keluarkan semua pengguna": ends every session of every user except `exceptSessionId` (the caller's). */
export function revokeAllSessions(db: Db, exceptSessionId: string): RevokedSessions {
  const own = db.select({ userId: session.userId }).from(session).where(eq(session.id, exceptSessionId)).get();
  if (!own) throw new Error(`revokeAllSessions: caller session ${exceptSessionId} not found`);
  const count = db.delete(session).where(ne(session.id, exceptSessionId)).returning({ id: session.id }).all().length;
  recordAudit(db, { actorId: own.userId, action: "session.revoke_all", target: "*", meta: { count } });
  log.info(`[auth] user ${own.userId} revoked all ${count} other session(s)`);
  return { revoked: count };
}
