import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { DeployKind, DeployStatus } from "../../../shared/deploy.types";
import type { SiteRuntime } from "../../../shared/site.types";
import { user } from "./auth.schema";
import { job, site } from "./site.schema";

/** Binary deploys and rollbacks of a site; sha256/size/runtime describe the binary put in place. */
export const deploy = sqliteTable(
  "deploy",
  {
    id: text("id").primaryKey(),
    siteName: text("site_name")
      .notNull()
      .references(() => site.name, { onDelete: "cascade" }),
    kind: text("kind").$type<DeployKind>().notNull(),
    status: text("status").$type<DeployStatus>().notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    runtime: text("runtime").$type<SiteRuntime>().notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => job.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    at: integer("at", { mode: "timestamp_ms" }).notNull(),
    // Original upload file name, sanitized, ≤ 255 chars (0007).
    fileName: text("file_name"),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    // Identity of the file this deploy put in place: "Aktif" = stat(app) matches; null on rows before 0007.
    binIno: integer("bin_ino"),
    binMtimeMs: integer("bin_mtime_ms"),
  },
  (t) => [index("deploy_site_at_idx").on(t.siteName, t.at)],
);
