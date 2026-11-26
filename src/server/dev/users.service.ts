import { count, desc, eq, or, sql } from "drizzle-orm";
import type { AssignableRole, DevUser, Page } from "../../shared/dev.types";
import { isRole } from "../../shared/roles";
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { allowedEmail, user } from "../db/schema";
import { log } from "../log.service";
import { ApiError, type Paging } from "../routes/http.error";

/** Context for user management: DB, env super admin emails (lowercase) and the acting super_admin. */
export type UsersCtx = { db: Db; superAdmins: readonly string[]; actorId: string };

// Spelled out with aliases: drizzle renders single-table columns unqualified, so `"id"` would bind to session.id.
const lastSeen = sql<
  number | null
>`(select max("s"."updated_at") from "session" "s" where "s"."user_id" = "user"."id")`;

const columns = {
  id: user.id,
  email: user.email,
  name: user.name,
  image: user.image,
  role: user.role,
  createdAt: user.createdAt,
  lastSeen,
};

type Row = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string;
  createdAt: Date;
  lastSeen: number | null;
};

const toDevUser = (r: Row, superAdmins: readonly string[]): DevUser => ({
  id: r.id,
  email: r.email,
  name: r.name,
  image: r.image,
  role: isRole(r.role) ? r.role : "user",
  createdAt: r.createdAt.toISOString(),
  lastSeenAt: r.lastSeen === null ? null : new Date(r.lastSeen).toISOString(),
  isEnvSuperAdmin: superAdmins.includes(r.email.toLowerCase()),
});

// LIKE wildcards in user input are matched literally.
const likeFilter = (q: string) => {
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return or(sql`${user.email} like ${pattern} escape '\\'`, sql`${user.name} like ${pattern} escape '\\'`);
};

/** One page of users (newest first), optionally filtered by `q` on email/name; lastSeenAt via subquery. */
export function listUsers(db: Db, superAdmins: readonly string[], paging: Paging, q?: string): Page<DevUser> {
  const where = q ? likeFilter(q) : undefined;
  const rows = db
    .select(columns)
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt), user.id)
    .limit(paging.pageSize)
    .offset(paging.offset)
    .all();
  const total = db.select({ n: count() }).from(user).where(where).get()?.n ?? 0;
  return { items: rows.map((r) => toDevUser(r, superAdmins)), total, page: paging.page, pageSize: paging.pageSize };
}

function getUser(db: Db, superAdmins: readonly string[], id: string): DevUser {
  const row = db.select(columns).from(user).where(eq(user.id, id)).get();
  if (!row) throw new ApiError(404, "not_found", `user ${id} not found`);
  return toDevUser(row, superAdmins);
}

function assertMutable({ db, superAdmins, actorId }: UsersCtx, id: string): DevUser {
  const target = getUser(db, superAdmins, id);
  if (target.isEnvSuperAdmin)
    throw new ApiError(409, "protected", "env super admins are managed via SUPER_ADMIN_EMAILS");
  if (id === actorId) throw new ApiError(409, "protected", "you cannot change your own account");
  return target;
}

/** Sets role user/admin; 409 protected for env super admins and the caller. */
export function changeRole(ctx: UsersCtx, id: string, role: AssignableRole): DevUser {
  const before = assertMutable(ctx, id);
  if (before.role === role) return before;
  ctx.db.update(user).set({ role }).where(eq(user.id, id)).run();
  recordAudit(ctx.db, {
    actorId: ctx.actorId,
    action: "user.role_change",
    target: id,
    meta: { from: before.role, to: role },
  });
  log.info(`[dev] user ${id} role ${before.role} -> ${role} by ${ctx.actorId}`);
  return getUser(ctx.db, ctx.superAdmins, id);
}

/** Deletes a user with its sessions/accounts (FK cascade) and its invite; 409 protected like changeRole. */
export function deleteUser(ctx: UsersCtx, id: string): void {
  const target = assertMutable(ctx, id);
  ctx.db.transaction((tx) => {
    tx.delete(allowedEmail).where(eq(allowedEmail.email, target.email.toLowerCase())).run();
    tx.delete(user).where(eq(user.id, id)).run();
  });
  recordAudit(ctx.db, { actorId: ctx.actorId, action: "user.delete", target: id });
  log.info(`[dev] user ${id} deleted by ${ctx.actorId}`);
}
