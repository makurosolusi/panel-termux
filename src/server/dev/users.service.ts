import { count, eq, or, type SQL, sql } from "drizzle-orm";
import type { AssignableRole, DevUser, Page } from "../../shared/dev.types";
import { isRole, type Role } from "../../shared/roles";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { user } from "../db/schema";
import { log } from "../log.service";
import { ApiError, type Paging } from "../routes/http.error";

/** Context for user management: DB and the acting super_admin. */
export type UsersCtx = { db: Db; actorId: string };

/** Filters of GET /api/dev/users: `q` on email/name, exact role. */
export type UsersFilter = { q?: string; role?: Role };

// Spelled out with aliases: drizzle renders single-table columns unqualified, so `"id"` would bind to session.id.
// K9: newest session touch; once sessions are gone, the newest `auth.sign_in` audit row of that user.
const lastSeen = sql<number | null>`coalesce(
  (select max("s"."updated_at") from "session" "s" where "s"."user_id" = "user"."id"),
  (select max("a"."at") from "audit_log" "a" where "a"."action" = 'auth.sign_in' and "a"."actor_id" = "user"."id"))`;
const activeSessions = (now: number) =>
  sql<number>`(select count(*) from "session" "s" where "s"."user_id" = "user"."id" and "s"."expires_at" > ${now})`;
const roleRank = sql`case ${user.role} when 'super_admin' then 0 when 'admin' then 1 else 2 end`;

const columns = (now: number) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  image: user.image,
  role: user.role,
  createdAt: user.createdAt,
  lastSeen,
  activeSessions: activeSessions(now),
});

type Row = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string;
  createdAt: Date;
  lastSeen: number | null;
  activeSessions: number;
};

// super_admin is granted only from SUPER_ADMIN_EMAILS (synced at boot and on every sign-in), so the stored role
// says whether the account is an env super admin.
const toDevUser = (r: Row): DevUser => {
  const role: Role = isRole(r.role) ? r.role : "user";
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    image: r.image,
    role,
    createdAt: r.createdAt.toISOString(),
    lastSeenAt: r.lastSeen === null ? null : new Date(r.lastSeen).toISOString(),
    activeSessions: r.activeSessions,
    isEnvSuperAdmin: role === "super_admin",
  };
};

// LIKE wildcards in user input are matched literally.
const likeFilter = (q: string) => {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return or(sql`${user.email} like ${pattern} escape '\\'`, sql`${user.name} like ${pattern} escape '\\'`);
};

const whereOf = ({ q, role }: UsersFilter): SQL | undefined => {
  const conds = [q ? likeFilter(q) : undefined, role ? eq(user.role, role) : undefined].filter(
    (c): c is SQL => c !== undefined,
  );
  return conds.length ? sql.join(conds, sql` and `) : undefined;
};

/** One page of users: super_admin → admin → user, then last seen (newest first, never-seen last). */
export function listUsers(db: Db, paging: Paging, filter: UsersFilter = {}, now = Date.now()): Page<DevUser> {
  const where = whereOf(filter);
  const rows = db
    .select(columns(now))
    .from(user)
    .where(where)
    .orderBy(roleRank, sql`${lastSeen} desc nulls last`, user.id)
    .limit(paging.pageSize)
    .offset(paging.offset)
    .all();
  const total = db.select({ n: count() }).from(user).where(where).get()?.n ?? 0;
  return { items: rows.map(toDevUser), total, page: paging.page, pageSize: paging.pageSize };
}

function getUser(db: Db, id: string): DevUser {
  const row = db.select(columns(Date.now())).from(user).where(eq(user.id, id)).get();
  if (!row) throw new ApiError(404, "not_found", `user ${id} not found`);
  return toDevUser(row);
}

function assertMutable({ db, actorId }: UsersCtx, id: string): DevUser {
  const target = getUser(db, id);
  if (target.isEnvSuperAdmin)
    throw new ApiError(409, "protected", "env super admins are managed via SUPER_ADMIN_EMAILS");
  if (id === actorId) throw new ApiError(409, "protected", "you cannot change your own account");
  return target;
}

/** Sets role user/admin; 409 protected for env super admins and the caller. Audit keeps the target email. */
export function changeRole(ctx: UsersCtx, id: string, role: AssignableRole): DevUser {
  const before = assertMutable(ctx, id);
  if (before.role === role) return before;
  ctx.db.update(user).set({ role }).where(eq(user.id, id)).run();
  recordAudit(ctx.db, {
    actorId: ctx.actorId,
    action: "user.role_change",
    target: id,
    meta: { from: before.role, to: role, targetEmail: before.email },
  });
  log.info(`[dev] user ${id} role ${before.role} -> ${role} by ${ctx.actorId}`);
  return getUser(ctx.db, id);
}

/**
 * Deletes a user with its sessions/accounts (FK cascade); 409 protected like changeRole. Sign-in is
 * open, so the same Google account may sign in again later as a fresh `user`.
 */
export function deleteUser(ctx: UsersCtx, id: string): void {
  const target = assertMutable(ctx, id);
  ctx.db.delete(user).where(eq(user.id, id)).run();
  recordAudit(ctx.db, {
    actorId: ctx.actorId,
    action: "user.delete",
    target: id,
    meta: { targetEmail: target.email },
  });
  log.info(`[dev] user ${id} deleted by ${ctx.actorId}`);
}

/**
 * DELETE /api/me: a `user` deletes their own account after typing their email (G27). admin/super_admin are refused
 * so the panel never loses its managers. Audited before the row goes, so the label survives.
 */
export function deleteOwnAccount(db: Db, me: { id: string; email: string; role: Role }, confirm: unknown): void {
  if (me.role !== "user")
    throw new ApiError(403, "forbidden", "only accounts with the user role can delete themselves");
  if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== me.email.toLowerCase())
    throw new ApiError(400, "confirm_mismatch", "type your own email to confirm");
  recordAudit(db, { actorId: me.id, action: "user.self_delete", target: me.id, meta: { targetEmail: me.email } });
  db.delete(user).where(eq(user.id, me.id)).run();
  log.info(`[dev] user ${me.id} deleted their own account`);
}
