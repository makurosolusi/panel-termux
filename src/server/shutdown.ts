import { log } from "./log.service";

/** How long a running site/deploy job or backup may delay exit after SIGTERM (runit never escalates). */
export const SHUTDOWN_TIMEOUT_MS = 20_000;

/** What graceful shutdown stops, in order: server → scheduler → wait for work → DB → exit. */
export type ShutdownDeps = {
  server: { stop(closeActive?: boolean): unknown };
  stopScheduler: () => void;
  /** Resolve when background work (site jobs, backup run) is finished. */
  idle: (() => Promise<unknown>)[];
  closeDb: () => void;
  exit?: (code: number) => void;
  timeoutMs?: number;
};

/** Returns the signal handler; a second signal while shutting down is ignored. */
export function createShutdown({
  server,
  stopScheduler,
  idle,
  closeDb,
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
    log.info("[panel] stopped");
    exit(0);
  };
}
