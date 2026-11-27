// panel rollback (PLAN/07 §5.1, D12, m13, m17): swaps ~/panel/panel and panel.prev so `panel` exists at every step,
// never executes panel.prev (binaries < 0.5.0 ignore argv and would start a second server), `--db` restores the
// newest pre-migration snapshot, then restarts through runit and waits for a new boot on /api/health.
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { detectRuntime } from "../server/deploy/elf.runtime";
import { ENV_VARS, type EnvVar, type EnvVarName } from "../shared/env.schema";
import { type CliHost, probePaths } from "./cli.host";
import type { CliIo, Command, ParsedArgs } from "./cli.main";
import { CliExit, type CliOut } from "./cli.output";
import { REINSTALL } from "./doctor.checks.base";
import { readEnvFile } from "./env.file";

/** Test knobs: health wait, poll interval, a hook after every swap step, the clock for the backup name. */
export type RollbackOpts = {
  healthTimeoutMs?: number;
  pollMs?: number;
  onSwapStep?: (step: string) => void;
  now?: Date;
};

const FAILED = 1;
const NEEDS_USER = 3;
const CANCELLED = 4;
const SV_WAIT_SEC = 130; // panel shutdown waits up to 120 s for a running site change (same as panel init, K9)
const SV_TIMEOUT_MS = (SV_WAIT_SEC + 10) * 1000;
const HEALTH_TIMEOUT_MS = 30_000;
const POLL_MS = 1000;
const PROBE_MS = 1000;
const HTTP_OK = 200;
const SNAPSHOT = /^panel\.db\.(.+)\.(\d{14})$/;
const BEFORE = "before-rollback";
const SWAP_HINT = "Periksa izin folder ~/panel, lalu jalankan panel rollback lagi.";
const AFTER_SWAP_HINT = "Binary sudah ditukar. Periksa runit (panel doctor), lalu jalankan: sv restart panel";

const envDefault = (name: EnvVarName) => (ENV_VARS as readonly EnvVar[]).find((v) => v.name === name)?.default ?? "";
const errText = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const showStamp = (s: string) => s.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, "$1-$2-$3 $4:$5:$6");

function fsyncPath(path: string): void {
  const fd = fs.openSync(path, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Swap without a gap: copy prev → panel.new (755, fsync), hardlink panel → panel.old, rename panel.new → panel,
 * rename panel.old → panel.prev (directory fsynced after each rename). A crash leaves `panel` runnable.
 */
export function swapBinary(dir: string, onStep: (step: string) => void = () => {}): void {
  const [cur, prev, next, old] = [
    join(dir, "panel"),
    join(dir, "panel.prev"),
    join(dir, "panel.new"),
    join(dir, "panel.old"),
  ];
  const step = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (e) {
      throw new CliExit(FAILED, `Gagal menukar binary: ${name} keluar dengan ${errText(e)}.`, SWAP_HINT);
    }
    onStep(name);
  };
  step(`salin ${prev} ke ${next}`, () => {
    fs.copyFileSync(prev, next);
    fs.chmodSync(next, 0o755);
    fsyncPath(next);
  });
  step(`link ${cur} ke ${old}`, () => fs.linkSync(cur, old));
  step(`rename ${next} ke ${cur}`, () => {
    fs.renameSync(next, cur);
    fsyncPath(dir);
  });
  step(`rename ${old} ke ${prev}`, () => {
    fs.renameSync(old, prev);
    fsyncPath(dir);
  });
}

/** A leftover panel.old: same file as panel = crash before the swap (removed, false); else finishes it (true). */
function finishInterruptedSwap(dir: string): boolean {
  const [cur, prev, old] = [join(dir, "panel"), join(dir, "panel.prev"), join(dir, "panel.old")];
  if (!fs.existsSync(old)) return false;
  if (fs.statSync(old).ino === fs.statSync(cur).ino) {
    fs.rmSync(old);
    return false;
  }
  fs.renameSync(old, prev);
  fsyncPath(dir);
  return true;
}

/** Newest `snapshots/panel.db.<version>.<stamp>` (before-rollback copies excluded), or null. */
function latestSnapshot(dataDir: string): { file: string; version: string; stamp: string } | null {
  const dir = join(dataDir, "snapshots");
  if (!fs.existsSync(dir)) return null;
  const found = fs
    .readdirSync(dir)
    .map((f) => ({ f, m: SNAPSHOT.exec(f) }))
    .filter((x) => x.m && x.m[1] !== BEFORE)
    .map(({ f, m }) => ({ file: join(dir, f), version: m?.[1] ?? "", stamp: m?.[2] ?? "" }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp) || b.file.localeCompare(a.file)); // tie-break: never readdir order
  return found[0] ?? null;
}

/** app_meta.panel_version read-only (K12); null when unreadable. Lab L6: skip a -wal without -shm (would create it). */
function dbPanelVersion(db: string, out: CliOut): string | null {
  if (!fs.existsSync(db) || (fs.existsSync(`${db}-wal`) && !fs.existsSync(`${db}-shm`))) return null;
  let conn: Database | undefined;
  try {
    conn = new Database(db, { readonly: true });
    const row = conn.query("SELECT value FROM app_meta WHERE key = 'panel_version'").get() as { value: string } | null;
    return row?.value ?? null;
  } catch (e) {
    out.note(`ℹ️ Versi database tidak terbaca (${(e as Error).message}); pemeriksaan migrasi dilewati.`);
    return null;
  } finally {
    conn?.close();
  }
}

/** Current panel.db → before-rollback copy (VACUUM INTO, 600), then snapshot → panel.db via tmp + rename. */
function restoreDb(db: string, snapshot: string, now: Date): string {
  const backup = join(dirname(snapshot), `panel.db.${BEFORE}.${stamp(now)}`);
  try {
    if (fs.existsSync(db)) {
      const conn = new Database(db);
      try {
        conn.run("VACUUM INTO ?", [backup]);
      } finally {
        conn.close();
      }
      fs.chmodSync(backup, 0o600);
    }
    const tmp = `${db}.rollback.tmp`;
    fs.copyFileSync(snapshot, tmp);
    fs.chmodSync(tmp, 0o600);
    fsyncPath(tmp);
    // WAL files belong to the old database; removed before the rename so SQLite never pairs them with the snapshot.
    fs.rmSync(`${db}-wal`, { force: true });
    fs.rmSync(`${db}-shm`, { force: true });
    fs.renameSync(tmp, db);
    fsyncPath(dirname(db));
  } catch (e) {
    throw new CliExit(FAILED, `Gagal memulihkan database dari ${snapshot}: ${errText(e)}.`, AFTER_SWAP_HINT);
  }
  return backup;
}

async function sv(host: CliHost, action: "down" | "restart"): Promise<number> {
  const env = { ...process.env, SVDIR: host.paths.svdir, LOGDIR: host.paths.logdir };
  try {
    const r = await host.exec("sv", ["-w", String(SV_WAIT_SEC), action, "panel"], { env, timeoutMs: SV_TIMEOUT_MS });
    return r.code;
  } catch (e) {
    throw new CliExit(FAILED, `Gagal menjalankan sv ${action} panel: ${(e as Error).message}`, AFTER_SWAP_HINT);
  }
}

type Health = { version: string; bootId: unknown };
/** /api/health of the local panel; null = not answering. Fake mode asks the fake net (fresh boot id each time). */
async function health(host: CliHost, port: number): Promise<Health | null> {
  if (host.mode === "fake")
    return (await host.system().net.httpStatus(port, "/api/health", PROBE_MS)) === HTTP_OK
      ? { version: "fake", bootId: crypto.randomUUID() }
      : null;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(PROBE_MS) });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown; bootId?: unknown };
    return { version: typeof body.version === "string" ? body.version : "?", bootId: body.bootId };
  } catch {
    return null; // refused, timeout or no JSON = not answering (yet); the caller polls until its deadline
  }
}

/** `panel rollback` with test knobs; see the file header. */
export async function runRollback(args: ParsedArgs, io: CliIo, opts: RollbackOpts = {}): Promise<number> {
  const { out } = io;
  const host = await io.host();
  const p = probePaths(host.paths);
  const dir = host.paths.panelDir;
  if (!fs.existsSync(p.binary)) throw new CliExit(FAILED, `Tidak ada binary panel di ${p.binary}.`, REINSTALL);
  if (finishInterruptedSwap(dir))
    throw new CliExit(
      FAILED,
      "Rollback sebelumnya terputus setelah binary ditukar; langkah terakhirnya sudah diselesaikan.",
      "jalankan: sv restart panel, lalu panel doctor",
    );
  if (!fs.existsSync(p.prev))
    throw new CliExit(
      FAILED,
      `Tidak ada versi sebelumnya: ${p.prev} tidak ada.`,
      "panel init menyimpannya saat upgrade",
    );
  let runtime: string;
  try {
    runtime = detectRuntime(p.prev);
  } catch (e) {
    throw new CliExit(FAILED, `panel.prev tidak bisa dipakai: ${(e as Error).message}. Tidak ada yang diubah.`);
  }
  if (runtime !== "native")
    throw new CliExit(
      FAILED,
      "panel.prev adalah build glibc (butuh grun), bukan build Android. Tidak ada yang diubah.",
    );

  const env = readEnvFile(p.envFile) ?? {};
  const dataDir = resolve(dir, env.PANEL_DATA_DIR || envDefault("PANEL_DATA_DIR"));
  const port = Number(env.PORT || envDefault("PORT"));
  const db = join(dataDir, "panel.db");
  const snap = latestSnapshot(dataDir);
  const dbVersion = dbPanelVersion(db, out);
  const withDb = args.values.db === true;

  out.line("Rencana rollback:");
  out.line(`  ${p.prev} menjadi ${p.binary}; versi yang sekarang berjalan menjadi panel.prev`);
  if (snap && dbVersion && dbVersion !== snap.version && !withDb)
    out.check(
      "warning",
      `Database sudah dimigrasi oleh v${dbVersion}.`,
      "Bila panel lama error saat start: panel rollback --db",
    );
  if (withDb) {
    if (!snap)
      throw new CliExit(
        FAILED,
        `Tidak ada snapshot database di ${join(dataDir, "snapshots")}.`,
        "jalankan panel rollback tanpa --db",
      );
    const need = (fs.existsSync(db) ? fs.statSync(db).size : 0) + fs.statSync(snap.file).size;
    if (host.freeBytes(dataDir) < need)
      throw new CliExit(
        FAILED,
        `Ruang tidak cukup untuk --db: butuh ${Math.ceil(need / 1e6)} MB kosong.`,
        "kosongkan ruang, lalu ulangi",
      );
    out.line(
      `  database kembali ke snapshot v${snap.version} dari ${showStamp(snap.stamp)}; perubahan data setelah waktu itu hilang`,
    );
    out.line(`  database sekarang disimpan dulu sebagai snapshots/panel.db.${BEFORE}.<waktu>`);
  }
  out.line("  panel di-restart lewat runit (sv restart panel); situs lain tetap jalan");
  if (args.values.yes !== true) {
    if (!host.tty.isTty)
      throw new CliExit(
        NEEDS_USER,
        "Rollback butuh konfirmasi, tapi tidak ada terminal.",
        "jalankan lagi dengan --yes",
      );
    if (!(await host.tty.confirm("Lanjutkan rollback?"))) {
      out.line("Dibatalkan, tidak ada yang diubah.");
      return CANCELLED;
    }
  }

  const before = await health(host, port);
  swapBinary(dir, opts.onSwapStep);
  out.check("ok", "Binary ditukar: panel = versi sebelumnya, panel.prev = versi yang tadi berjalan");
  if (withDb && snap) {
    const code = await sv(host, "down");
    if (code !== 0)
      throw new CliExit(FAILED, `sv down panel keluar dengan kode ${code}; database tidak diubah.`, AFTER_SWAP_HINT);
    const backup = restoreDb(db, snap.file, opts.now ?? new Date());
    out.check("ok", `Database dipulihkan dari snapshot v${snap.version}; salinan sebelumnya: ${backup}`);
  }
  const code = await sv(host, "restart");
  if (code !== 0) out.note(`ℹ️ sv restart panel keluar dengan kode ${code}; menunggu panel menjawab.`);
  const deadline = Date.now() + (opts.healthTimeoutMs ?? HEALTH_TIMEOUT_MS);
  for (;;) {
    const now = await health(host, port);
    if (now && (!before || now.bootId === undefined || now.bootId !== before.bootId)) {
      out.check("ok", `Panel berjalan lagi (v${now.version}).`);
      out.line(`→ untuk kembali ke versi tadi: ${p.prev} rollback`);
      return 0;
    }
    if (Date.now() >= deadline) break;
    await Bun.sleep(opts.pollMs ?? POLL_MS);
  }
  throw new CliExit(
    FAILED,
    `Panel belum menjawab /api/health di port ${port} setelah restart.`,
    `lihat ${join(host.paths.logdir, "sv", "panel", "current")}; untuk kembali: ${p.prev} rollback`,
  );
}

/** Dispatcher entry (wired in cli.main.ts at G1a). */
export const rollbackCommand: Command = (args, io) => runRollback(args, io);
