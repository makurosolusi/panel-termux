import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createShutdown } from "@/server/shutdown";
import { createJobRunner } from "@/server/sites/job.runner";

const dir = mkdtempSync(join(tmpdir(), "panel-shutdown-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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
          key: "slow",
          label: "slow",
          run: async () => {
            await gate;
            calls.push("job-done");
            return null;
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
  });

  test("gives up after the timeout, second signal is ignored", async () => {
    const { calls, jobs, shutdown, exitCode } = harness(50);
    jobs.start({
      kind: "site.deploy",
      target: "stuck",
      actorId: null as unknown as string, // test-only
      steps: [{ key: "hang", label: "hang", run: () => new Promise(() => {}) }],
    });
    const first = shutdown("SIGTERM");
    await shutdown("SIGINT");
    await first;
    expect(calls).toEqual(["stop", "scheduler", "db", "exit"]);
    expect(exitCode()).toBe(0);
  });
});
