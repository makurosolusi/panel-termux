import { and, count, desc, eq, gte, inArray, lt, not, or, type SQL, sql } from "drizzle-orm";
import type { AuditAction, AuditActorKind } from "../shared/audit.types";
import type { DevAuditEntry, Page } from "../shared/dev.types";
import type { Db } from "./db/client";
import { auditLog, user } from "./db/schema";
import { currentRequest } from "./http/request.context";
import type { Paging } from "./routes/http.error";

const DAY_MS = 86_400_000;

/** One audit event. `meta` must never carry secrets or setting values. */
export type AuditEvent = {
  actorId: string | null;
  action: AuditAction;
  target?: string | null;
  meta?: Record<string, unknown> | null;
  /** Defaults to `user` with an actor, `system` without one. */
  actorKind?: AuditActorKind;
};

/**
 * Appends an event to audit_log. The actor's name/email are copied at write time (they survive account
 * deletion); masked IP, short user agent and request id come from the current request (null outside one).
 */
export function recordAudit(db: Db, { actorId, action, target = null, meta = null, actorKind }: AuditEvent): void {
  try {
    const actor = actorId
      ? db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, actorId)).get()
      : undefined;
    const req = currentRequest();
    db.insert(auditLog)
      .values({
        actorId,
        actorKind: actorKind ?? (actorId ? "user" : "system"),
        actorLabel: actor?.name ?? null,
        actorEmail: actor?.email ?? null,
        ipMasked: req?.ipMasked ?? null,
        userAgent: req?.userAgent ?? null,
        requestId: req?.requestId ?? null,
        action,
        target,
        meta,
      })
      .run();
  } catch (e) {
    throw new Error(`recordAudit ${action} failed: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * Filters for listAudit. `action`: OR of values; one ending in `.` matches as a prefix. `from` inclusive,
 * `to` exclusive (the route turns a date into the next local midnight). `excludePrefixes` drop actions.
 */
export type AuditFilter = {
  action?: string | string[];
  actorId?: string;
  from?: Date;
  to?: Date;
  excludePrefixes?: string[];
};

/** `LIKE 'prefix%'` with `%`, `_` and `\` in the prefix escaped. */
const likePrefix = (prefix: string) => {
  const pattern = `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql`${auditLog.action} LIKE ${pattern} ESCAPE '\\'`;
};

function whereOf({ action, actorId, from, to, excludePrefixes = [] }: AuditFilter): SQL | undefined {
  const conds: SQL[] = [];
  const actions = (typeof action === "string" ? [action] : (action ?? [])).filter(Boolean);
  if (actions.length) {
    const exact = actions.filter((a) => !a.endsWith("."));
    const parts = actions.filter((a) => a.endsWith(".")).map(likePrefix);
    if (exact.length) parts.push(inArray(auditLog.action, exact));
    const any = or(...parts);
    if (any) conds.push(any);
  }
  if (actorId) conds.push(eq(auditLog.actorId, actorId));
  if (from) conds.push(gte(auditLog.at, from));
  if (to) conds.push(lt(auditLog.at, to));
  for (const p of excludePrefixes) conds.push(not(likePrefix(p)));
  return conds.length ? and(...conds) : undefined;
}

/** One page of audit entries, newest first; the live actor is joined, the write-time label kept. */
export function listAudit(db: Db, paging: Paging, filter: AuditFilter = {}): Page<DevAuditEntry> {
  const where = whereOf(filter);
  const rows = db
    .select({ e: auditLog, liveName: user.name })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(where)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(paging.pageSize)
    .offset(paging.offset)
    .all();
  const total = db.select({ n: count() }).from(auditLog).where(where).get()?.n ?? 0;
  const items = rows.map(({ e, liveName }) => ({
    id: e.id,
    at: e.at.toISOString(),
    actor: e.actorId && liveName !== null ? { id: e.actorId, name: liveName } : null,
    actorKind: e.actorKind,
    actorLabel: e.actorLabel ?? liveName,
    actorEmail: e.actorEmail,
    actorDeleted: e.actorKind === "user" && liveName === null,
    action: e.action,
    target: e.target,
    meta: e.meta ?? null,
    ipMasked: e.ipMasked,
    userAgent: e.userAgent,
    requestId: e.requestId,
  }));
  return { items, total, page: paging.page, pageSize: paging.pageSize };
}

/**
 * Deletes audit rows older than `retentionDays` (setting `audit.retention_days`) and records `audit.prune`
 * when anything went. Returns the number of deleted rows.
 */
export function pruneAudit(db: Db, retentionDays: number, now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const deleted = db.delete(auditLog).where(lt(auditLog.at, cutoff)).returning({ id: auditLog.id }).all().length;
  if (deleted > 0) recordAudit(db, { actorId: null, action: "audit.prune", meta: { deleted } });
  return deleted;
}
