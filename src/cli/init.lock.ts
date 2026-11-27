// `panel init` lock (split from init.command.ts): one init at a time per phone, stale locks (dead or reused pid)
// are taken over.
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CliHost } from "./cli.host";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { INIT_EXIT } from "./init.types";

const errCode = (e: unknown) => (e as NodeJS.ErrnoException).code ?? (e as Error).message;

/** pid in a lock file still runs `init` (m7: dead pid, or a reused pid running something else, = stale). */
function lockHeld(host: CliHost, pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || !host.proc.alive(pid)) return false;
  return host.proc.list().some((p) => p.pid === pid && p.cmdline.includes("init"));
}

const readLock = (file: string): string | null => {
  try {
    return readFileSync(file, "utf8").trim();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CliExit(
      INIT_EXIT.failed,
      tr(`Could not read lock ${file}: ${errCode(e)}.`, `Gagal membaca lock ${file}: ${errCode(e)}.`),
    );
  }
};

/** `$PREFIX/tmp/panel-init.lock` (O_EXCL, holds our pid; outside $HOME, C20). Returns an idempotent release. */
export function acquireLock(host: CliHost): () => void {
  const file = join(host.paths.prefix, "tmp", "panel-init.lock");
  const own = String(host.proc.selfPid);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const fd = openSync(file, "wx", 0o600);
      try {
        writeSync(fd, `${own}\n`);
      } finally {
        closeSync(fd);
      }
      let held = true;
      return () => {
        // a lock another init took over after ours was removed by hand is not ours to delete
        if (held && readLock(file) === own) rmSync(file, { force: true });
        held = false;
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST")
        throw new CliExit(
          INIT_EXIT.failed,
          tr(`Could not create lock ${file}: ${errCode(e)}.`, `Gagal membuat lock ${file}: ${errCode(e)}.`),
        );
    }
    const text = readLock(file);
    if (text === null) continue; // released meanwhile
    const pid = Number(text);
    if (lockHeld(host, pid))
      throw new CliExit(
        INIT_EXIT.failed,
        tr(`Another panel init is running (pid ${pid}).`, `panel init lain sedang berjalan (pid ${pid}).`),
        tr(
          `wait until it finishes; if none is running: rm ${file}`,
          `tunggu sampai selesai; bila tidak ada yang berjalan: rm ${file}`,
        ),
      );
    // stale (m7); removed only while it still holds that pid, so a lock a racing init just took stays
    // ponytail: read-then-rm leaves a tiny window; a rename-based lock closes it if two inits ever really race
    if (readLock(file) === text) rmSync(file, { force: true });
  }
  throw new CliExit(
    INIT_EXIT.failed,
    tr(
      `Could not create lock ${file}: another process recreated it.`,
      `Gagal membuat lock ${file}: dibuat ulang proses lain.`,
    ),
    tr("run panel init again", "ulangi panel init"),
  );
}
