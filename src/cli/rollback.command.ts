// panel rollback (PLAN/07 §5.1, D12, m13, m17): swaps ~/panel/panel and panel.prev so `panel` exists at every step,
// never executes panel.prev (binaries < 0.5.0 ignore argv and would start a second server), `--db` restores the
// newest pre-migration snapshot, then restarts through runit and waits for a new boot on /api/health.
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { detectRuntime } from "../server/deploy/elf.runtime";
import { ENV_VARS, type EnvVar, type EnvVarName } from "../shared/env.schema";
import { type CliHost, probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import type { CliIo, Command, ParsedArgs } from "./cli.main";
import { CliExit } from "./cli.output";
import { reinstall } from "./doctor.checks.base";
import { readEnvFile } from "./env.file";
import {
  afterSwapHint,
  BEFORE,
  dbPanelVersion,
  finishInterruptedSwap,
  latestSnapshot,
  restoreDb,
  swapBinary,
} from "./rollback.files";

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
const envDefault = (name: EnvVarName) => (ENV_VARS as readonly EnvVar[]).find((v) => v.name === name)?.default ?? "";
const showStamp = (s: string) => s.replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, "$1-$2-$3 $4:$5:$6");

async function sv(host: CliHost, action: "down" | "restart"): Promise<number> {
  const env = { ...process.env, SVDIR: host.paths.svdir, LOGDIR: host.paths.logdir };
  try {
    const r = await host.exec("sv", ["-w", String(SV_WAIT_SEC), action, "panel"], { env, timeoutMs: SV_TIMEOUT_MS });
    return r.code;
  } catch (e) {
    const why = (e as Error).message;
    throw new CliExit(
      FAILED,
      tr(`sv ${action} panel failed: ${why}`, `Gagal menjalankan sv ${action} panel: ${why}`),
      afterSwapHint(),
    );
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
  if (!fs.existsSync(p.binary))
    throw new CliExit(
      FAILED,
      tr(`There is no panel binary at ${p.binary}.`, `Tidak ada binary panel di ${p.binary}.`),
      reinstall(),
    );
  if (finishInterruptedSwap(dir))
    throw new CliExit(
      FAILED,
      tr(
        "The previous rollback was interrupted after the binary swap; its last step is now finished.",
        "Rollback sebelumnya terputus setelah binary ditukar; langkah terakhirnya sudah diselesaikan.",
      ),
      tr("run: sv restart panel, then panel doctor", "jalankan: sv restart panel, lalu panel doctor"),
    );
  if (!fs.existsSync(p.prev))
    throw new CliExit(
      FAILED,
      tr(`There is no previous version: ${p.prev} does not exist.`, `Tidak ada versi sebelumnya: ${p.prev} tidak ada.`),
      tr("panel init keeps it during an upgrade", "panel init menyimpannya saat upgrade"),
    );
  let runtime: string;
  try {
    runtime = detectRuntime(p.prev);
  } catch (e) {
    const why = (e as Error).message;
    throw new CliExit(
      FAILED,
      tr(
        `panel.prev cannot be used: ${why}. Nothing was changed.`,
        `panel.prev tidak bisa dipakai: ${why}. Tidak ada yang diubah.`,
      ),
    );
  }
  if (runtime !== "native")
    throw new CliExit(
      FAILED,
      tr(
        "panel.prev is a glibc build (needs grun), not an Android build. Nothing was changed.",
        "panel.prev adalah build glibc (butuh grun), bukan build Android. Tidak ada yang diubah.",
      ),
    );

  const env = readEnvFile(p.envFile) ?? {};
  const dataDir = resolve(dir, env.PANEL_DATA_DIR || envDefault("PANEL_DATA_DIR"));
  const port = Number(env.PORT || envDefault("PORT"));
  const db = join(dataDir, "panel.db");
  const snap = latestSnapshot(dataDir);
  const dbVersion = dbPanelVersion(db, out);
  const withDb = args.values.db === true;

  out.line(tr("Rollback plan:", "Rencana rollback:"));
  out.line(
    tr(
      `  ${p.prev} becomes ${p.binary}; the version running now becomes panel.prev`,
      `  ${p.prev} menjadi ${p.binary}; versi yang sekarang berjalan menjadi panel.prev`,
    ),
  );
  if (snap && dbVersion && dbVersion !== snap.version && !withDb)
    out.check(
      "warning",
      tr(`The database was already migrated by v${dbVersion}.`, `Database sudah dimigrasi oleh v${dbVersion}.`),
      tr(
        "If the old panel fails to start: panel rollback --db",
        "Bila panel lama error saat start: panel rollback --db",
      ),
    );
  if (withDb) {
    if (!snap)
      throw new CliExit(
        FAILED,
        tr(
          `There is no database snapshot in ${join(dataDir, "snapshots")}.`,
          `Tidak ada snapshot database di ${join(dataDir, "snapshots")}.`,
        ),
        tr("run panel rollback without --db", "jalankan panel rollback tanpa --db"),
      );
    const need = (fs.existsSync(db) ? fs.statSync(db).size : 0) + fs.statSync(snap.file).size;
    if (host.freeBytes(dataDir) < need)
      throw new CliExit(
        FAILED,
        tr(
          `Not enough space for --db: ${Math.ceil(need / 1e6)} MB of free space needed.`,
          `Ruang tidak cukup untuk --db: butuh ${Math.ceil(need / 1e6)} MB kosong.`,
        ),
        tr("free up space, then try again", "kosongkan ruang, lalu ulangi"),
      );
    const at = showStamp(snap.stamp);
    out.line(
      tr(
        `  the database goes back to the v${snap.version} snapshot from ${at}; data changed after that time is lost`,
        `  database kembali ke snapshot v${snap.version} dari ${at}; perubahan data setelah waktu itu hilang`,
      ),
    );
    out.line(
      tr(
        `  the current database is saved first as snapshots/panel.db.${BEFORE}.<time>`,
        `  database sekarang disimpan dulu sebagai snapshots/panel.db.${BEFORE}.<waktu>`,
      ),
    );
  }
  out.line(
    tr(
      "  the panel restarts through runit (sv restart panel); other sites keep running",
      "  panel di-restart lewat runit (sv restart panel); situs lain tetap jalan",
    ),
  );
  if (args.values.yes !== true) {
    if (!host.tty.isTty)
      throw new CliExit(
        NEEDS_USER,
        tr(
          "Rollback needs a confirmation, but there is no terminal.",
          "Rollback butuh konfirmasi, tapi tidak ada terminal.",
        ),
        tr("run it again with --yes", "jalankan lagi dengan --yes"),
      );
    if (!(await host.tty.confirm(tr("Continue the rollback?", "Lanjutkan rollback?")))) {
      out.line(tr("Cancelled, nothing was changed.", "Dibatalkan, tidak ada yang diubah."));
      return CANCELLED;
    }
  }

  const before = await health(host, port);
  swapBinary(dir, opts.onSwapStep, host.link);
  out.check(
    "ok",
    tr(
      "Binary swapped: panel = the previous version, panel.prev = the version that was running",
      "Binary ditukar: panel = versi sebelumnya, panel.prev = versi yang tadi berjalan",
    ),
  );
  if (withDb && snap) {
    const code = await sv(host, "down");
    if (code !== 0)
      throw new CliExit(
        FAILED,
        tr(
          `sv down panel exited with code ${code}; the database was not changed.`,
          `sv down panel keluar dengan kode ${code}; database tidak diubah.`,
        ),
        afterSwapHint(),
      );
    const backup = restoreDb(db, snap.file, opts.now ?? new Date());
    out.check(
      "ok",
      tr(
        `Database restored from the v${snap.version} snapshot; previous copy: ${backup}`,
        `Database dipulihkan dari snapshot v${snap.version}; salinan sebelumnya: ${backup}`,
      ),
    );
  }
  const code = await sv(host, "restart");
  if (code !== 0)
    out.note(
      tr(
        `ℹ️ sv restart panel exited with code ${code}; waiting for the panel to answer.`,
        `ℹ️ sv restart panel keluar dengan kode ${code}; menunggu panel menjawab.`,
      ),
    );
  const deadline = Date.now() + (opts.healthTimeoutMs ?? HEALTH_TIMEOUT_MS);
  for (;;) {
    const now = await health(host, port);
    if (now && (!before || now.bootId === undefined || now.bootId !== before.bootId)) {
      out.check("ok", tr(`The panel is running again (v${now.version}).`, `Panel berjalan lagi (v${now.version}).`));
      out.line(
        tr(
          `→ to go back to the version from before: ${p.prev} rollback`,
          `→ untuk kembali ke versi tadi: ${p.prev} rollback`,
        ),
      );
      return 0;
    }
    if (Date.now() >= deadline) break;
    await Bun.sleep(opts.pollMs ?? POLL_MS);
  }
  throw new CliExit(
    FAILED,
    tr(
      `The panel does not answer /api/health on port ${port} after the restart yet.`,
      `Panel belum menjawab /api/health di port ${port} setelah restart.`,
    ),
    tr(
      `see ${join(host.paths.logdir, "sv", "panel", "current")}; to go back: ${p.prev} rollback`,
      `lihat ${join(host.paths.logdir, "sv", "panel", "current")}; untuk kembali: ${p.prev} rollback`,
    ),
  );
}

/** Dispatcher entry (wired in cli.main.ts at G1a). */
export const rollbackCommand: Command = (args, io) => runRollback(args, io);
