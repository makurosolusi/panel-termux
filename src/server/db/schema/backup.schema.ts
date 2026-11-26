import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  BackupItemErrorCode,
  BackupItemKind,
  BackupItemWarning,
  BackupRestore,
  BackupRestoreStatus,
  BackupRunStatus,
  BackupTrigger,
} from "../../../shared/backup.types";
import { user } from "./auth.schema";

/** Stored item of a run; `restoreHint` is derived on read. Optional fields are absent on rows before 0.3.0. */
export type BackupItemRow = {
  kind: BackupItemKind;
  name: string;
  key: string;
  sizeBytes: number | null;
  ok: boolean;
  error: string | null;
  errorCode?: BackupItemErrorCode | null;
  warning?: BackupItemWarning | null;
  sha256?: string | null;
  checked?: boolean | null;
  pruned?: boolean;
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
    // Run-level facts for retention (0006).
    includesSecrets: integer("includes_secrets", { mode: "boolean" }).notNull().default(false),
    panelVersion: text("panel_version"),
    prunedAt: integer("pruned_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("backup_run_started_at_idx").on(t.startedAt)],
);

/** "Pulihkan ke database baru" runs (0006); `targetDb` is the only database "Hapus database uji" may drop. */
export const backupRestore = sqliteTable(
  "backup_restore",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => backupRun.id, { onDelete: "cascade" }),
    itemIndex: integer("item_index").notNull(),
    sourceName: text("source_name").notNull(),
    targetDb: text("target_db").notNull(),
    status: text("status").$type<BackupRestoreStatus>().notNull(),
    error: text("error"),
    errorCode: text("error_code").$type<NonNullable<BackupRestore["errorCode"]>>(),
    tableCount: integer("table_count"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    droppedAt: integer("dropped_at", { mode: "timestamp_ms" }),
  },
  (t) => [index("backup_restore_started_at_idx").on(t.startedAt)],
);
