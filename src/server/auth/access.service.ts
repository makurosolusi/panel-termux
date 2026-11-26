import { eq } from "drizzle-orm";
import { isRole, type Role } from "../../shared/roles";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { user } from "../db/schema";
import { log } from "../log.service";

/**
 * Role policy (any Google account may sign in). Env super admins always get super_admin; everyone
 * else keeps the stored role, except a super_admin who left SUPER_ADMIN_EMAILS drops to `user`
 * (admin is granted only by a super_admin).
 */
export function decideRole(email: string, currentRole: Role, superAdminEmails: readonly string[]): Role {
  if (superAdminEmails.includes(email.toLowerCase())) return "super_admin";
  return currentRole === "super_admin" ? "user" : currentRole;
}

/** Applies the role policy to stored user `userId`, persists and audits a change, returns the resulting role. */
export function syncUserRole(db: Db, userId: string, superAdminEmails: readonly string[]): Role {
  const row = db.select({ email: user.email, role: user.role }).from(user).where(eq(user.id, userId)).get();
  if (!row) throw new Error(`syncUserRole: user ${userId} not found`);
  const role = decideRole(row.email, isRole(row.role) ? row.role : "user", superAdminEmails);
  if (role !== row.role) {
    db.update(user).set({ role }).where(eq(user.id, userId)).run();
    recordAudit(db, {
      actorId: null,
      action: "user.role_sync",
      target: userId,
      meta: { from: row.role, to: role, reason: "super_admin_emails" },
    });
    log.info(`[auth] user ${userId} role ${row.role} -> ${role}`);
  }
  return role;
}

/**
 * Boot-time pass so env changes apply without waiting for the next sign-in: demotes every
 * super_admin no longer in SUPER_ADMIN_EMAILS. Sessions stay (everyone may sign in); the role guard
 * reads the role fresh from the DB on each request.
 */
export function syncSuperAdminsOnBoot(db: Db, superAdminEmails: readonly string[]): void {
  // ponytail: one query per super_admin; fine for a handful of admins, batch if that ever grows.
  const rows = db.select({ id: user.id }).from(user).where(eq(user.role, "super_admin")).all();
  for (const { id } of rows) syncUserRole(db, id, superAdminEmails);
}
