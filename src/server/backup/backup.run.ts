import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { S3Client } from "bun";
import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import pkg from "../../../package.json" with { type: "json" };
import { recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { appMeta, type BackupItemRow, backupRestore, backupRun, site } from "../db/schema";
import { log } from "../log.service";
import type { SettingsDeps } from "../settings.service";
import { sitePaths } from "../sites/site.checks";
import type { SystemAdapters } from "../system/system.types";
import { type BackupConfig, describeS3Error, runKeyStem, type S3Config } from "./backup.config";
import {
  checkGlobals,
  cloudflaredEntries,
  type ItemCtx,
  type ItemSpec,
  quickCheck,
  runItem,
  sitesEntries,
  stageSecrets,
} from "./backup.items";
import { type BackupPaths, buildManifest, checksumsText, itemFile, parseTunnel } from "./backup.manifest";
import { applyPrune, planPrune } from "./backup.retention";

/** What a run needs. `freeBytes` is the disk-space probe (statfs in production, a stub in tests). */
export type RunDeps = SettingsDeps & { dataDir: string; system: SystemAdapters; freeBytes: (dir: string) => number };

/** Absolute paths of this phone for hints and the manifest; `panelDir` is the service's working dir. */
export function backupPaths(deps: RunDeps): BackupPaths {
  return {
    panelDir: process.cwd(),
    dataDir: deps.dataDir,
    sitesDir: sitePaths(deps).sitesDir,
    cloudflaredDir: dirname(deps.system.cloudflared.configPath),
  };
}

/** "Pulihkan ke database baru" targets still present and not used by a site: not backed up (F10.8). */
function restoreTestDbs(db: Db): Set<string> {
  const used = new Set(
    db
      .select({ d: site.database })
      .from(site)
      .where(isNotNull(site.database))
      .all()
      .map((r) => r.d),
  );
  const rows = db
    .select({ t: backupRestore.targetDb })
    .from(backupRestore)
    .where(isNull(backupRestore.droppedAt))
    .all();
  return new Set(rows.map((r) => r.t).filter((t) => !used.has(t)));
}

/** Sizes of the previous run's items by kind+name (space estimate, K7). */
function previousSizes(db: Db, runId: string): Map<string, number> {
  const prev = db.select().from(backupRun).where(ne(backupRun.id, runId)).orderBy(desc(sql`rowid`)).limit(1).get();
  return new Map((prev?.items ?? []).filter((i) => i.sizeBytes).map((i) => [`${i.kind}\0${i.name}`, i.sizeBytes ?? 0]));
}

/** One run's identity. */
export type RunInfo = { id: string; startedAt: Date; actorId: string | null };

/** Produces, checks and uploads every item in PLAN/04 F2 order, then checksums, manifest and retention. */
export async function executeRun(deps: RunDeps, run: RunInfo, cfg: BackupConfig, s3: S3Config): Promise<void> {
  const { db, system } = deps;
  const tmpDir = join(deps.dataDir, "backup-tmp");
  const client = new S3Client(s3);
  const stem = runKeyStem(cfg.prefix, run.startedAt);
  const items: BackupItemRow[] = [];
  const errors: string[] = [];
  const save = (patch: Partial<typeof backupRun.$inferInsert> = {}) =>
    db
      .update(backupRun)
      .set({ items: [...items], ...patch })
      .where(eq(backupRun.id, run.id))
      .run();
  const ctx: ItemCtx = {
    runId: run.id,
    client,
    s3,
    tmpDir,
    maxItemBytes: cfg.maxItemBytes,
    freeBytes: deps.freeBytes,
  };
  const prev = previousSizes(db, run.id);
  const add = async (spec: Omit<ItemSpec, "key" | "estimate"> & { estimate?: number }) => {
    const estimate = prev.get(`${spec.kind}\0${spec.name}`) ?? spec.estimate ?? 0;
    items.push(await runItem(ctx, { ...spec, estimate, key: `${stem}${itemFile(spec.kind, spec.name)}` }));
    save();
  };
  const listTar = (f: string) => system.archive.list(f);
  const paths = backupPaths(deps);
  mkdirSync(tmpDir, { recursive: true });

  await add({ kind: "globals", name: "globals", produce: (f) => system.postgres.dumpGlobals(f), check: checkGlobals });

  const skip = restoreTestDbs(db);
  try {
    const dbs = (await system.postgres.listDatabases()).filter((d) => !skip.has(d.name));
    for (const d of dbs.sort((a, b) => a.name.localeCompare(b.name)))
      await add({
        kind: "database",
        name: d.name,
        estimate: d.sizeBytes ?? 0,
        produce: (f) => system.postgres.dump(d.name, f),
        check: (f) => system.postgres.verifyDump(f),
      });
  } catch (e) {
    errors.push(`list databases: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (existsSync(paths.sitesDir)) {
    const outside = db
      .select({ dir: site.dir })
      .from(site)
      .all()
      .some((s) => !s.dir.replace(/^~(?=\/)/, system.home).startsWith(`${paths.sitesDir}/`));
    await add({
      kind: "sites",
      name: "sites",
      produce: async (f) => {
        const { warning } = await system.archive.create(f, paths.sitesDir, sitesEntries(paths.sitesDir));
        return outside ? "outside_sites_dir" : warning;
      },
      check: listTar,
    });
  }

  const cfYml = existsSync(system.cloudflared.configPath) ? readFileSync(system.cloudflared.configPath, "utf8") : null;
  if (existsSync(paths.cloudflaredDir) && cloudflaredEntries(paths.cloudflaredDir).length)
    await add({
      kind: "cloudflared",
      name: "cloudflared",
      produce: async (f) =>
        (await system.archive.create(f, paths.cloudflaredDir, cloudflaredEntries(paths.cloudflaredDir))).warning,
      check: listTar,
    });

  if (cfg.includeSecrets) {
    const cred = cfYml?.match(/^credentials-file:\s*(\S+)/m)?.[1];
    const credPath = cred && (existsSync(cred) ? cred : join(paths.cloudflaredDir, cred.split("/").pop() ?? ""));
    const stage = join(tmpDir, `secrets-${run.id}`);
    try {
      await add({
        kind: "secrets",
        name: "secrets",
        produce: async (f) => {
          const files = [join(deps.dataDir, "secret"), join(paths.panelDir, ".env"), ...(credPath ? [credPath] : [])];
          const names = stageSecrets(stage, files);
          if (!names.length) throw new Error("none of data/secret, .env, tunnel credentials exist");
          return (await system.archive.create(f, stage, names)).warning;
        },
        check: listTar,
      });
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  await add({
    kind: "panel",
    name: "panel",
    produce: async (f) => void db.$client.run("VACUUM INTO ?", [f]),
    check: quickCheck,
  });

  const sumsText = checksumsText(items);
  await add({
    kind: "checksums",
    name: "checksums",
    produce: async (f) => writeFileSync(f, sumsText),
    check: () => {},
  });

  let postgresVersion: string | null = null;
  try {
    postgresVersion = await system.postgres.serverVersion();
  } catch (e) {
    log.warn(`[backup] run ${run.id}: postgres version unknown: ${e instanceof Error ? e.message : String(e)}`);
  }
  const schemaVersion = db.select().from(appMeta).where(eq(appMeta.key, "schema_version")).get()?.value ?? "none";
  const manifest = buildManifest(
    {
      runId: run.id,
      createdAt: run.startedAt.toISOString(),
      panelVersion: pkg.version,
      schemaVersion,
      postgresVersion,
      // Validated at boot by loadEnvOrExit; only names go into the manifest.
      appBaseUrl: process.env.APP_BASE_URL ?? "",
      includesSecrets: cfg.includeSecrets,
      paths,
      tunnel: parseTunnel(cfYml),
      sites: db
        .select({ name: site.name, database: site.database, managed: site.managed })
        .from(site)
        .all()
        .map((s) => ({ name: s.name, database: s.database, needsBinary: s.managed })),
    },
    items,
  );
  await add({
    kind: "manifest",
    name: "manifest",
    produce: async (f) => writeFileSync(f, `${JSON.stringify(manifest, null, 2)}\n`),
    check: () => {},
  });

  const ok = items.filter((i) => i.ok).length;
  const status = ok === items.length && !errors.length ? "succeeded" : ok === 0 ? "failed" : "partial";
  save({ status, error: errors.length ? errors.join("; ") : null, finishedAt: new Date() });
  let pruned = 0;
  if (status !== "failed") {
    try {
      const runs = db
        .select()
        .from(backupRun)
        .where(and(isNull(backupRun.prunedAt), ne(backupRun.status, "running")))
        .orderBy(sql`rowid`)
        .all();
      const plan = planPrune(runs, cfg, new Date());
      pruned = (await applyPrune(db, client, s3, plan, run.id)).deleted;
    } catch (e) {
      log.error(`[backup] run ${run.id} retention failed: ${describeS3Error(e, s3)}`);
    }
  }
  const trigger = run.actorId ? "manual" : "schedule";
  recordAudit(db, {
    actorId: run.actorId,
    action: "backup.run",
    target: run.id,
    meta: { trigger, status, items: items.length },
  });
  log.info(`[backup] run ${run.id} ${status}: ${ok}/${items.length} items, pruned ${pruned}`);
}
