import { createHash } from "node:crypto";
import type { MigrationMeta } from "drizzle-orm/migrator";
import bundle from "../../../drizzle/migrations.js";
import type { Db } from "./client";
import { appMeta } from "./schema";

const BREAKPOINT = "--> statement-breakpoint";

/**
 * `dialect`/`session` are marked @internal in drizzle's .d.ts but are exactly what
 * drizzle-orm/bun-sqlite/migrator uses; we need them because that migrator only reads from disk.
 * Re-check on drizzle-orm major upgrades (covered by tests/db.migrate.test.ts).
 */
type MigratorInternals = {
  dialect: { migrate(m: MigrationMeta[], session: unknown, config: object): void };
  session: unknown;
};

/** Migrations embedded at build time (drizzle/migrations.js statically imports each .sql). */
export function embeddedMigrations(): MigrationMeta[] {
  return bundle.journal.entries.map((e) => {
    const query = bundle.migrations[`m${String(e.idx).padStart(4, "0")}`];
    if (query === undefined) throw new Error(`embedded migration ${e.tag} missing from drizzle/migrations.js`);
    return {
      sql: query.split(BREAKPOINT),
      bps: e.breakpoints,
      folderMillis: e.when,
      // Same hash as drizzle's file-based migrator, so `drizzle-kit migrate` and this stay interchangeable.
      hash: createHash("sha256").update(query).digest("hex"),
    };
  });
}

/** Tag of the newest embedded migration (what app_meta.schema_version reads once migrations ran). */
export const latestSchemaVersion = (): string => bundle.journal.entries.at(-1)?.tag ?? "none";

/** Applies pending embedded migrations, then records the schema version (last migration tag) in app_meta. */
export function runMigrations(db: Db): string {
  const migrations = embeddedMigrations();
  const version = latestSchemaVersion();
  try {
    const internals = db as unknown as MigratorInternals;
    internals.dialect.migrate(migrations, internals.session, {});
    db.insert(appMeta)
      .values({ key: "schema_version", value: version })
      .onConflictDoUpdate({ target: appMeta.key, set: { value: version } })
      .run();
  } catch (e) {
    throw new Error(`runMigrations to ${version} failed: ${(e as Error).message}`, { cause: e });
  }
  return version;
}
