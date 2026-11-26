import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { S3Client } from "bun";
import type { BackupItemErrorCode, BackupItemKind, BackupItemWarning } from "../../shared/backup.types";
import { SITE_BINARY_NAMES } from "../../shared/site.types";
import type { BackupItemRow } from "../db/schema";
import { log } from "../log.service";
import { describeS3Error, type S3Config } from "./backup.config";

/** Free space kept on top of an item's estimated size (PLAN/04 K7). */
export const SPACE_MARGIN_BYTES = 256 * 1024 * 1024;

/** Site-level names that are rebuilt, not backed up: binaries (K20), deps, half-written upload/swap temp files. */
const SITE_SKIP = new Set([...SITE_BINARY_NAMES, "node_modules"]);
const TEMP_FILE_RE = /\.(tmp|part)$/;

/** Bytes available to this process in `dir` (statfs). */
export function freeBytesIn(dir: string): number {
  const s = statfsSync(dir);
  return s.bavail * s.bsize;
}

/**
 * tar entries of the sites archive (K20, no glob): every top-level file of `sitesDir` (apps.json,
 * ecosystem.config.js, …) and each site folder's children except SITE_SKIP and temp files. The skip is
 * anchored at the site root only, so `<site>/data/app` or `<site>/web/node_modules` stay in.
 */
export function sitesEntries(sitesDir: string): string[] {
  const out: string[] = [];
  for (const top of readdirSync(sitesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!top.isDirectory()) {
      out.push(top.name);
      continue;
    }
    for (const child of readdirSync(join(sitesDir, top.name)).sort()) {
      if (SITE_SKIP.has(child) || TEMP_FILE_RE.test(child)) continue;
      out.push(`${top.name}/${child}`);
    }
  }
  return out;
}

/** `config.yml` and `config.yml.bak*` of the cloudflared folder (never cert.pem or credential JSON). */
export function cloudflaredEntries(cfDir: string): string[] {
  return readdirSync(cfDir)
    .filter((n) => n === "config.yml" || n.startsWith("config.yml.bak"))
    .sort();
}

/**
 * Stages the opt-in secret files (data/secret, <panelDir>/.env, the tunnel credentials JSON) into `stage`
 * and returns their names; missing ones are skipped.
 */
export function stageSecrets(stage: string, files: string[]): string[] {
  mkdirSync(stage, { recursive: true, mode: 0o700 });
  const names: string[] = [];
  for (const f of files) {
    if (!existsSync(f)) continue;
    copyFileSync(f, join(stage, basename(f)));
    names.push(basename(f));
  }
  return names;
}

/** PRAGMA quick_check on a read-only open of the panel snapshot. */
export function quickCheck(file: string): void {
  const db = new Database(file, { readonly: true });
  try {
    const r = db.query("PRAGMA quick_check").get() as { quick_check: string } | null;
    if (r?.quick_check !== "ok") throw new Error(`quick_check ${basename(file)}: ${r?.quick_check ?? "no result"}`);
  } finally {
    db.close();
  }
}

/** pg_dumpall output: non-empty and the first line is an SQL comment. */
export async function checkGlobals(file: string): Promise<void> {
  const text = await Bun.file(file).text();
  if (!text.length || !text.startsWith("--")) throw new Error("globals.sql is empty or does not start with --");
}

/** Hex sha256 of a file, streamed. */
export async function sha256File(file: string): Promise<string> {
  const h = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) h.update(chunk);
  return h.digest("hex");
}

/** Everything one item needs: where it goes and how it is produced and checked. */
export type ItemSpec = {
  kind: BackupItemKind;
  name: string;
  key: string;
  /** Expected size for the space check (same item of the last run, DB size, else 0). */
  estimate: number;
  /** Resolves to a BackupItemWarning for a non-fatal note (tar "file changed"), anything else = none. */
  produce(file: string): Promise<unknown>;
  check(file: string): Promise<void> | void;
};

/** Shared per-run context of the item pipeline. */
export type ItemCtx = {
  runId: string;
  client: S3Client;
  s3: S3Config;
  tmpDir: string;
  maxItemBytes: number;
  freeBytes: (dir: string) => number;
};

class ItemError extends Error {
  constructor(
    readonly code: BackupItemErrorCode,
    message: string,
  ) {
    super(message);
  }
}

async function step<T>(code: BackupItemErrorCode, fn: () => T | Promise<T>, s3: S3Config): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new ItemError(code, describeS3Error(e, s3));
  }
}

/**
 * One item (PLAN/04 F2.4): space → produce → size cap → structure check → sha256 → write → stat. A size
 * mismatch deletes the object. The temp file is always removed. Never throws: failures become the row.
 */
export async function runItem(ctx: ItemCtx, spec: ItemSpec): Promise<BackupItemRow> {
  const { kind, name, key } = spec;
  const file = join(ctx.tmpDir, `${crypto.randomUUID()}.tmp`);
  const base = { kind, name, key, warning: null as BackupItemWarning | null, pruned: false };
  let checked: boolean | null = null;
  try {
    const free = ctx.freeBytes(ctx.tmpDir);
    if (free < spec.estimate + SPACE_MARGIN_BYTES)
      throw new ItemError("insufficient_space", `free ${free} B < estimate ${spec.estimate} B + margin`);
    base.warning = ((await step("produce_failed", () => spec.produce(file), ctx.s3)) as BackupItemWarning) || null;
    const sizeBytes = statSync(file).size;
    if (sizeBytes > ctx.maxItemBytes)
      throw new ItemError("too_large", `${sizeBytes} B over backup.max_item_mb (${ctx.maxItemBytes} B)`);
    checked = false;
    await step("check_failed", () => spec.check(file), ctx.s3);
    checked = true;
    const sha256 = await sha256File(file);
    await step("upload_failed", () => ctx.client.write(key, Bun.file(file)), ctx.s3);
    const remote = await step("upload_failed", () => ctx.client.stat(key), ctx.s3);
    if (remote.size !== sizeBytes) {
      await ctx.client
        .delete(key)
        .catch((e) => log.warn(`[backup] delete mismatched ${key}: ${describeS3Error(e, ctx.s3)}`));
      throw new ItemError("upload_mismatch", `uploaded ${remote.size} B, local ${sizeBytes} B`);
    }
    return { ...base, sizeBytes, ok: true, error: null, errorCode: null, sha256, checked };
  } catch (e) {
    const code = e instanceof ItemError ? e.code : "produce_failed";
    const error = `${kind} ${name} -> ${key}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400);
    log.warn(`[backup] run ${ctx.runId} item failed (${code}): ${error}`);
    return { ...base, warning: null, sizeBytes: null, ok: false, error, errorCode: code, sha256: null, checked };
  } finally {
    rmSync(file, { force: true });
  }
}
