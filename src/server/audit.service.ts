import { and, count, desc, eq, type SQL } from "drizzle-orm";
import type { DevAuditEntry, Page } from "../shared/dev.types";
import type { Db } from "./db/client";
import { auditLog, user } from "./db/schema";
import type { Paging } from "./routes/http.error";

/** Known audit actions; panel waves add theirs here. */
export type AuditAction =
  | "auth.sign_in"
  | "auth.denied"
  | "user.role_change"
  | "user.delete"
  | "invite.create"
  | "invite.delete"
  | "settings.update";

/** One audit event. `meta` must never carry secrets or setting values. */
export type AuditEvent = {
  actorId: string | null;
  action: AuditAction;
  target?: string | null;
  meta?: Record<string, unknown> | null;
};

/** Appends an event to audit_log. */
export function recordAudit(db: Db, { actorId, action, target = null, meta = null }: AuditEvent): void {
  try {
    db.insert(auditLog).values({ actorId, action, target, meta }).run();
  } catch (e) {
    throw new Error(`recordAudit ${action} failed: ${(e as Error).message}`, { cause: e });
  }
}

/** Domain part of an email, so audit/log entries for strangers avoid storing the full address. */
export const emailDomain = (email: string): string => email.split("@").pop()?.toLowerCase() ?? "";

/** Optional filters for listAudit (exact match). */
export type AuditFilter = { action?: string; actorId?: string };

/** One page of audit entries, newest first, with actor name joined. */
export function listAudit(db: Db, paging: Paging, { action, actorId }: AuditFilter = {}): Page<DevAuditEntry> {
  const conds: SQL[] = [];
  if (action) conds.push(eq(auditLog.action, action));
  if (actorId) conds.push(eq(auditLog.actorId, actorId));
  const where = conds.length ? and(...conds) : undefined;
  const rows = db
    .select({ e: auditLog, actorName: user.name })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(where)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(paging.pageSize)
    .offset(paging.offset)
    .all();
  const total = db.select({ n: count() }).from(auditLog).where(where).get()?.n ?? 0;
  const items = rows.map(({ e, actorName }) => ({
    id: e.id,
    at: e.at.toISOString(),
    actor: e.actorId ? { id: e.actorId, name: actorName ?? "" } : null,
    action: e.action,
    target: e.target,
    meta: e.meta ?? null,
  }));
  return { items, total, page: paging.page, pageSize: paging.pageSize };
}
