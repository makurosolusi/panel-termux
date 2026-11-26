import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { AuditActorKind } from "../../../shared/audit.types";
import { user } from "./auth.schema";

/** Append-only audit trail of security-relevant actions (never stores secret values). */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    // Keep the trail when the actor is deleted.
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    // Snapshot of the actor at write time (0006), so the trail stays readable after the account is deleted.
    actorKind: text("actor_kind").$type<AuditActorKind>().notNull().default("unknown"),
    actorLabel: text("actor_label"),
    actorEmail: text("actor_email"),
    // Request origin (0006): masked IP only, never the raw address.
    ipMasked: text("ip_masked"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    action: text("action").notNull(),
    target: text("target"),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_action_idx").on(t.action)],
);
