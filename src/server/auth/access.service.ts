import { eq } from "drizzle-orm";
import { isRole, type Role } from "../../shared/roles";
import type { Db } from "../db/client";
import { allowedEmail, session, user } from "../db/schema";

/** Error code Better Auth puts in `/login?error=` when an account is not invited. */
export const NOT_INVITED = "not_invited";

/** Result of the invite/role policy for one account. */
export type AccessDecision = { allowed: false } | { allowed: true; role: Role };

/**
 * Invite-only policy. Env super admins always get super_admin; anyone else must be invited, and a
 * super_admin who left SUPER_ADMIN_EMAILS drops to `user` (admin is granted only by a super_admin).
 */
export function decideAccess(email: string, currentRole: Role, superAdminEmails: readonly string[], invited: boolean) {
  if (superAdminEmails.includes(email.toLowerCase())) return { allowed: true, role: "super_admin" } as AccessDecision;
  if (!invited) return { allowed: false } as AccessDecision;
  return { allowed: true, role: currentRole === "super_admin" ? "user" : currentRole } as AccessDecision;
}

/** Whether `email` (any case) is on the allowed_email invite list. */
export function isInvited(db: Db, email: string): boolean {
  const row = db
    .select({ email: allowedEmail.email })
    .from(allowedEmail)
    .where(eq(allowedEmail.email, email.toLowerCase()))
    .get();
  return row !== undefined;
}

/** Whether `email` may sign in at all (env super admin or invited). */
export const isEmailAllowed = (db: Db, email: string, superAdminEmails: readonly string[]): boolean =>
  superAdminEmails.includes(email.toLowerCase()) || isInvited(db, email);

/**
 * Applies the policy to stored user `userId` and persists a role change. Returns the decision;
 * callers refuse the session when `allowed` is false.
 */
export function syncUserRole(db: Db, userId: string, superAdminEmails: readonly string[]): AccessDecision {
  const row = db.select({ email: user.email, role: user.role }).from(user).where(eq(user.id, userId)).get();
  if (!row) throw new Error(`syncUserRole: user ${userId} not found`);
  const current: Role = isRole(row.role) ? row.role : "user";
  const decision = decideAccess(row.email, current, superAdminEmails, isInvited(db, row.email));
  if (decision.allowed && decision.role !== row.role) {
    db.update(user).set({ role: decision.role }).where(eq(user.id, userId)).run();
    console.info(`[auth] user ${userId} role ${row.role} -> ${decision.role}`);
  }
  return decision;
}

/**
 * Boot-time pass so env changes apply without waiting for the next sign-in: re-syncs every
 * super_admin and revokes sessions of those who lost access entirely.
 */
export function syncSuperAdminsOnBoot(db: Db, superAdminEmails: readonly string[]): void {
  // ponytail: one query per super_admin; fine for a handful of admins, batch if that ever grows.
  const rows = db.select({ id: user.id }).from(user).where(eq(user.role, "super_admin")).all();
  for (const { id } of rows) {
    if (!syncUserRole(db, id, superAdminEmails).allowed) {
      db.delete(session).where(eq(session.userId, id)).run();
      console.info(`[auth] user ${id} lost access; sessions revoked`);
    }
  }
}
