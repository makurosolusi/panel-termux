import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { HealthExpect, JobKind, JobStatus, JobStep, SiteRuntime } from "../../../shared/site.types";
import { user } from "./auth.schema";

const createdAt = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

/** Hosted site. `managed` false = adopted (hand-written pm2 entry); `app` = its pm2 process name. */
export const site = sqliteTable("site", {
  name: text("name").primaryKey(),
  port: integer("port").notNull().unique(),
  app: text("app"),
  database: text("database"),
  runtime: text("runtime").$type<SiteRuntime>().notNull(),
  managed: integer("managed", { mode: "boolean" }).notNull(),
  dir: text("dir").notNull(),
  createdAt: createdAt(),
  // Health check (0007). Defaults keep the pre-0007 rule ("any status < 500" at /) for existing rows.
  healthPath: text("health_path").notNull().default("/"),
  healthExpect: text("health_expect").$type<HealthExpect>().notNull().default("lt500"),
  healthTimeoutSec: integer("health_timeout_sec").notNull().default(60),
});

/**
 * Hostnames of a site. `ingressManaged` = the panel inserted the ingress rule (may remove it);
 * `dnsManaged` = the panel's DNS provider owns the record.
 */
export const siteHostname = sqliteTable(
  "site_hostname",
  {
    hostname: text("hostname").primaryKey(),
    siteName: text("site_name")
      .notNull()
      .references(() => site.name, { onDelete: "cascade" }),
    ingressManaged: integer("ingress_managed", { mode: "boolean" }).notNull(),
    dnsManaged: integer("dns_managed", { mode: "boolean" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("site_hostname_site_idx").on(t.siteName)],
);

/** Site jobs (create/delete/hostname add/remove) with their step log; never holds env values or passwords. */
export const job = sqliteTable(
  "job",
  {
    id: text("id").primaryKey(),
    kind: text("kind").$type<JobKind>().notNull(),
    target: text("target").notNull(),
    status: text("status").$type<JobStatus>().notNull(),
    steps: text("steps", { mode: "json" }).$type<JobStep[]>().notNull(),
    error: text("error"),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    // Recovery journal (0007): non-secret request input (names, hostnames, port, sha256, flags; env keys only).
    input: text("input", { mode: "json" }).$type<Record<string, unknown>>(),
    // Id of the cleanup/retry job that resolved this one; null = still needs attention when interrupted/failed.
    resolvedBy: text("resolved_by"),
  },
  (t) => [index("job_started_at_idx").on(t.startedAt), index("job_target_started_idx").on(t.target, t.startedAt)],
);
