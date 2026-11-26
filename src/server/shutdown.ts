import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { log } from "./log.service";

/**
 * How long a running site/deploy job or backup may delay exit after SIGTERM (runit never escalates).
 * 120 s covers a typical change on the phone (PLAN/03 §4.12, D32); a longer one is marked interrupted on boot.
 */
export const SHUTDOWN_TIMEOUT_MS = 120_000;

/** File in the data dir written on graceful exit; boot reads + deletes it to tell an unexpected stop (PLAN/02 K20). */
export const CLEAN_SHUTDOWN_MARKER = "clean-shutdown";

/** Boot side of the marker: true when the previous process exited gracefully; the marker is removed either way. */
export function consumeCleanShutdownMarker(dataDir: string): boolean {
  const path = join(dataDir, CLEAN_SHUTDOWN_MARKER);
  const clean = existsSync(path);
  rmSync(path, { force: true });
  return clean;
}

/** What graceful shutdown stops, in order: server → scheduler → wait for work → DB → marker → exit. */
export type ShutdownDeps = {
  server: { stop(closeActive?: boolean): unknown };
  stopScheduler: () => void;
  /** Resolve when background work (site jobs, backup run) is finished. */
  idle: (() => Promise<unknown>)[];
  closeDb: () => void;
  /** Panel data dir for the clean-shutdown marker. */
  dataDir: string;
  exit?: (code: number) => void;
  timeoutMs?: number;
};

/** Returns the signal handler; a second signal while shutting down is ignored. */
export function createShutdown({
  server,
  stopScheduler,
  idle,
  closeDb,
  dataDir,
  exit = (code) => process.exit(code),
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
}: ShutdownDeps) {
  let started = false;
  return async (signal: string): Promise<void> => {
    if (started) return;
    started = true;
    log.info(`[panel] ${signal} received: stopping (waiting up to ${timeoutMs} ms for running jobs)`);
    server.stop(false); // stop accepting; in-flight requests finish
    stopScheduler();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((r) => {
      timer = setTimeout(() => r(true), timeoutMs);
    });
    const finished = Promise.all(idle.map((f) => f())).then(
      () => false,
      (e: unknown) => {
        log.error(`[panel] waiting for jobs failed: ${(e as Error).message}`);
        return false;
      },
    );
    const late = await Promise.race([finished, timedOut]);
    clearTimeout(timer);
    if (late) log.warn("[panel] shutdown timeout: exiting with a job still running (marked interrupted on boot)");
    try {
      closeDb();
    } catch (e) {
      log.error(`[panel] closing the database failed: ${(e as Error).message}`);
    }
    // The stop was asked for (signal), so it is not "unexpected" even after the timeout: a cut-off job shows up
    // on its own as interrupted.
    try {
      writeFileSync(join(dataDir, CLEAN_SHUTDOWN_MARKER), `${new Date().toISOString()} ${signal}\n`);
    } catch (e) {
      log.error(`[panel] writing the clean-shutdown marker failed: ${(e as Error).message}`);
    }
    log.info("[panel] stopped");
    exit(0);
  };
}
