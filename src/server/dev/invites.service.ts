import { count, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { DevInvite, Page } from "../../shared/dev.types";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { allowedEmail, session, user } from "../db/schema";
import { EMAIL_RE } from "../env";
import { log } from "../log.service";
import { ApiError, type Paging } from "../routes/http.error";

/** Context for invite management: DB, env super admin emails (lowercase) and the acting super_admin. */
export type InvitesCtx = { db: Db; superAdmins: readonly string[]; actorId: string };

const inviter = alias(user, "inviter");
const member = alias(user, "member");

const select = (db: Db) =>
  db
    .select({
      email: allowedEmail.email,
      createdAt: allowedEmail.createdAt,
      inviterId: inviter.id,
      inviterName: inviter.name,
      memberId: member.id,
    })
    .from(allowedEmail)
    .leftJoin(inviter, eq(inviter.id, allowedEmail.invitedBy))
    .leftJoin(member, eq(member.email, allowedEmail.email));

type Row = {
  email: string;
  createdAt: Date;
  inviterId: string | null;
  inviterName: string | null;
  memberId: string | null;
};

const toDevInvite = (r: Row): DevInvite => ({
  email: r.email,
  invitedBy: r.inviterId ? { id: r.inviterId, name: r.inviterName ?? "" } : null,
  createdAt: r.createdAt.toISOString(),
  registered: r.memberId !== null,
});

/** One page of invites, newest first, with inviter and whether the email already has an account. */
export function listInvites(db: Db, paging: Paging): Page<DevInvite> {
  const rows = select(db)
    .orderBy(desc(allowedEmail.createdAt), allowedEmail.email)
    .limit(paging.pageSize)
    .offset(paging.offset)
    .all();
  const total = db.select({ n: count() }).from(allowedEmail).get()?.n ?? 0;
  return { items: rows.map(toDevInvite), total, page: paging.page, pageSize: paging.pageSize };
}

/** Invites `rawEmail` (lowercased); 400 invalid_email, 409 exists (also for env super admin emails). */
export function createInvite({ db, superAdmins, actorId }: InvitesCtx, rawEmail: unknown): DevInvite {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) throw new ApiError(400, "invalid_email", "email must be a valid address");
  if (superAdmins.includes(email)) throw new ApiError(409, "exists", "env super admins need no invite");
  const inserted = db
    .insert(allowedEmail)
    .values({ email, invitedBy: actorId })
    .onConflictDoNothing()
    .returning({ email: allowedEmail.email })
    .all();
  if (inserted.length === 0) throw new ApiError(409, "exists", "this email is already invited");
  recordAudit(db, { actorId, action: "invite.create", target: email });
  log.info(`[dev] invite created by ${actorId}`);
  const row = select(db).where(eq(allowedEmail.email, email)).get();
  if (!row) throw new Error("createInvite: inserted invite not found");
  return toDevInvite(row);
}

/** Removes the invite and revokes every session of that email's user (env super admins keep theirs). */
export function deleteInvite({ db, superAdmins, actorId }: InvitesCtx, rawEmail: string): void {
  const email = rawEmail.trim().toLowerCase();
  const revoked = db.transaction((tx) => {
    const del = tx
      .delete(allowedEmail)
      .where(eq(allowedEmail.email, email))
      .returning({ email: allowedEmail.email })
      .all();
    if (del.length === 0) throw new ApiError(404, "not_found", "invite not found");
    if (superAdmins.includes(email)) return 0;
    const u = tx.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
    return u ? tx.delete(session).where(eq(session.userId, u.id)).returning({ id: session.id }).all().length : 0;
  });
  recordAudit(db, { actorId, action: "invite.delete", target: email, meta: { sessionsRevoked: revoked } });
  log.info(`[dev] invite deleted by ${actorId}; ${revoked} sessions revoked`);
}
