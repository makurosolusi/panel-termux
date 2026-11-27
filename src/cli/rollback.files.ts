// Files side of `panel rollback` (split from rollback.command.ts): the gap-free binary swap, recovery of an
// interrupted swap, and the pre-migration database snapshot (find, read version, restore).
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fsyncPath, type LinkFn, linkOrCopy, sameFile } from "../shared/file.link";
import { tr } from "./cli.locale";
import { CliExit, type CliOut } from "./cli.output";

const FAILED = 1;
const SNAPSHOT = /^panel\.db\.(.+)\.(\d{14})$/;
/** Snapshot name part of the copy taken before a database rollback (never itself a rollback target). */
export const BEFORE = "before-rollback";
const swapHint = () =>
  tr(
    "Check the permissions of the ~/panel folder, then run panel rollback again.",
    "Periksa izin folder ~/panel, lalu jalankan panel rollback lagi.",
  );
/** Hint once the binary was swapped (runit / sv restart). */
export const afterSwapHint = () =>
  tr(
    "The binary was already swapped. Check runit (panel doctor), then run: sv restart panel",
    "Binary sudah ditukar. Periksa runit (panel doctor), lalu jalankan: sv restart panel",
  );

const errText = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

/**
 * Swap without a gap: copy prev → panel.new (755, fsync), keep panel as panel.old (hardlink, or on Termux a fsynced
 * copy via panel.old.tmp, E9), rename panel.new → panel, rename panel.old → panel.prev (directory fsynced after
 * each rename). A crash leaves `panel` runnable, and panel.old is only ever a complete file.
 */
export function swapBinary(dir: string, onStep: (step: string) => void = () => {}, link: LinkFn = fs.linkSync): void {
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
      throw new CliExit(
        FAILED,
        tr(
          `Swapping the binary failed: ${name} ended with ${errText(e)}.`,
          `Gagal menukar binary: ${name} keluar dengan ${errText(e)}.`,
        ),
        swapHint(),
      );
    }
    onStep(name);
  };
  step(tr(`copy ${prev} to ${next}`, `salin ${prev} ke ${next}`), () => {
    fs.copyFileSync(prev, next);
    fs.chmodSync(next, 0o755);
    fsyncPath(next);
  });
  step(tr(`keep ${cur} as ${old}`, `simpan ${cur} sebagai ${old}`), () => {
    linkOrCopy(cur, old, { link, via: `${old}.tmp` });
  });
  step(tr(`rename ${next} to ${cur}`, `rename ${next} ke ${cur}`), () => {
    fs.renameSync(next, cur);
    fsyncPath(dir);
  });
  step(tr(`rename ${old} to ${prev}`, `rename ${old} ke ${prev}`), () => {
    fs.renameSync(old, prev);
    fsyncPath(dir);
  });
}

/**
 * A partial panel.old.tmp is removed. A leftover panel.old: same bytes as panel = crash before the swap (removed,
 * false); else finishes it (true).
 */
export function finishInterruptedSwap(dir: string): boolean {
  const [cur, prev, old] = [join(dir, "panel"), join(dir, "panel.prev"), join(dir, "panel.old")];
  fs.rmSync(`${old}.tmp`, { force: true });
  if (!fs.existsSync(old)) return false;
  if (sameFile(old, cur)) {
    fs.rmSync(old);
    return false;
  }
  fs.renameSync(old, prev);
  fsyncPath(dir);
  return true;
}

/** Newest `snapshots/panel.db.<version>.<stamp>` (before-rollback copies excluded), or null. */
export function latestSnapshot(dataDir: string): { file: string; version: string; stamp: string } | null {
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
export function dbPanelVersion(db: string, out: CliOut): string | null {
  if (!fs.existsSync(db) || (fs.existsSync(`${db}-wal`) && !fs.existsSync(`${db}-shm`))) return null;
  let conn: Database | undefined;
  try {
    conn = new Database(db, { readonly: true });
    const row = conn.query("SELECT value FROM app_meta WHERE key = 'panel_version'").get() as { value: string } | null;
    return row?.value ?? null;
  } catch (e) {
    const why = (e as Error).message;
    out.note(
      tr(
        `ℹ️ The database version cannot be read (${why}); the migration check is skipped.`,
        `ℹ️ Versi database tidak terbaca (${why}); pemeriksaan migrasi dilewati.`,
      ),
    );
    return null;
  } finally {
    conn?.close();
  }
}

/** Current panel.db → before-rollback copy (VACUUM INTO, 600), then snapshot → panel.db via tmp + rename. */
export function restoreDb(db: string, snapshot: string, now: Date): string {
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
    throw new CliExit(
      FAILED,
      tr(
        `Restoring the database from ${snapshot} failed: ${errText(e)}.`,
        `Gagal memulihkan database dari ${snapshot}: ${errText(e)}.`,
      ),
      afterSwapHint(),
    );
  }
  return backup;
}
