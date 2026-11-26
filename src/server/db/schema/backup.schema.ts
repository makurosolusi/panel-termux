import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { BackupRunStatus, BackupTrigger } from "../../../shared/backup.types";
import { user } from "./auth.schema";

/** Stored item of a run; `restoreHint` is derived on read, not stored. */
export type BackupItemRow = {
  kind: "database" | "panel";
  name: string;
  key: string;
  sizeBytes: number | null;
  ok: boolean;
  error: string | null;
};

/** Off-device backup runs (one row per run, items as JSON). Never holds credentials. */
export const backupRun = sqliteTable(
  "backup_run",
  {
    id: text("id").primaryKey(),
    trigger: text("trigger").$type<BackupTrigger>().notNull(),
    status: text("status").$type<BackupRunStatus>().notNull(),
    items: text("items", { mode: "json" }).$type<BackupItemRow[]>().notNull(),
    error: text("error"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("backup_run_started_at_idx").on(t.startedAt)],
);
