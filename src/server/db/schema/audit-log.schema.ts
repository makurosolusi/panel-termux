import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth.schema";

/** Append-only audit trail of security-relevant actions (never stores secret values). */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    // Keep the trail when the actor is deleted.
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    meta: text("meta", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_action_idx").on(t.action)],
);
