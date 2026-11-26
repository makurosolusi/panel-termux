import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import {
  CLEAN_SHUTDOWN_MARKER,
  consumeCleanShutdownMarker,
  createShutdown,
  SHUTDOWN_TIMEOUT_MS,
} from "@/server/shutdown";
import { createJobRunner } from "@/server/sites/job.runner";

const dir = mkdtempSync(join(tmpdir(), "panel-shutdown-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const marker = join(dir, CLEAN_SHUTDOWN_MARKER);

function harness(timeoutMs = 2_000) {
  const calls: string[] = [];
  const db = openDb(dir);
  runMigrations(db);
  const jobs = createJobRunner(db);
  let exitCode: number | null = null;
  const shutdown = createShutdown({
    server: { stop: () => calls.push("stop") },
    stopScheduler: () => calls.push("scheduler"),
    idle: [() => jobs.idle()],
    closeDb: () => {
      calls.push("db");
      db.$client.close();
    },
    dataDir: dir,
    exit: (c) => {
      calls.push("exit");
      exitCode = c;
    },
    timeoutMs,
  });
  return { calls, jobs, shutdown, exitCode: () => exitCode };
}

describe("graceful shutdown", () => {
  test("stops the server, waits for the running job, then closes the DB and exits 0", async () => {
    const { calls, jobs, shutdown, exitCode } = harness();
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    jobs.start({
      kind: "site.deploy",
      target: "blog",
      actorId: null as unknown as string, // test-only: no user row needed
      steps: [
        {
          key: "app_restart",
          run: async () => {
            await gate;
            calls.push("job-done");
            return { code: "ok" };
          },
        },
      ],
    });
    const done = shutdown("SIGTERM");
    await Bun.sleep(30);
    expect(calls).toEqual(["stop", "scheduler"]); // still waiting for the job
    expect(exitCode()).toBeNull();
    release();
    await done;
    expect(calls).toEqual(["stop", "scheduler", "job-done", "db", "exit"]);
    expect(exitCode()).toBe(0);
    expect(readFileSync(marker, "utf8")).toContain("SIGTERM");
  });

  test("gives up after the timeout, second signal is ignored", async () => {
    const { calls, jobs, shutdown, exitCode } = harness(50);
    jobs.start({
      kind: "site.deploy",
      target: "stuck",
      actorId: null as unknown as string, // test-only
      steps: [{ key: "app_restart", run: () => new Promise(() => {}) }],
    });
    const first = shutdown("SIGTERM");
    await shutdown("SIGINT");
    await first;
    expect(calls).toEqual(["stop", "scheduler", "db", "exit"]);
    expect(exitCode()).toBe(0);
    // An asked-for stop is not "unexpected" even after the timeout; the cut-off job is interrupted on next boot.
    expect(existsSync(marker)).toBe(true);
    const reopened = openDb(dir);
    expect(createJobRunner(reopened).list({ page: 1, pageSize: 1, offset: 0 }).items[0]?.status).toBe("interrupted");
    reopened.$client.close();
  });

  test("default timeout is 120 s (PLAN/03 D32)", () => {
    expect(SHUTDOWN_TIMEOUT_MS).toBe(120_000);
  });
});

describe("clean-shutdown marker", () => {
  test("consume: true and removed when present, false when absent", () => {
    writeFileSync(marker, "x");
    expect(consumeCleanShutdownMarker(dir)).toBe(true);
    expect(existsSync(marker)).toBe(false);
    expect(consumeCleanShutdownMarker(dir)).toBe(false);
  });

  test("no data dir → no marker written (boot not wired yet)", async () => {
    rmSync(marker, { force: true });
    await createShutdown({
      server: { stop: () => {} },
      stopScheduler: () => {},
      idle: [],
      closeDb: () => {},
      exit: () => {},
    })("SIGTERM");
    expect(existsSync(marker)).toBe(false);
  });
});
