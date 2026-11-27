// Starting core services from the panel removes their runit `down` file (PLAN/06 F8, §6.1).
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { auditLog, user } from "@/server/db/schema";
import type { MonitorService } from "@/server/monitor/monitor.service";
import { createPanelService } from "@/server/panel/panel.service";
import { createFakeSystem } from "@/server/system/system.fake";

const dir = mkdtempSync(join(tmpdir(), "panel-service-start-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("controlService start", () => {
  test("pm2/postgres start deletes `down`, then starts (audited); crond start keeps its down file", async () => {
    const db = openDb(dir);
    runMigrations(db);
    db.insert(user).values({ id: "a1", email: "admin@contoh.test", name: "Admin" }).run(); // test-only
    const home = join(dir, "home");
    const system = createFakeSystem({ home, supervisorDown: true });
    const restarted: string[] = [];
    const monitor = { noteIntentionalRestart: ({ name }) => restarted.push(name), patch: () => {} } as Pick<
      MonitorService,
      "noteIntentionalRestart" | "patch"
    > as MonitorService;
    const panel = createPanelService({
      db,
      secret: "s".repeat(32), // test-only
      system,
      monitor,
      jobs: { active: () => null, isLocked: () => false },
      backup: { busy: () => false },
    });
    const down = (name: string) => join(home, "usr", "var", "service", name, "down");
    for (const name of ["pm2", "postgres", "crond"]) {
      mkdirSync(join(down(name), ".."), { recursive: true });
      writeFileSync(down(name), "");
    }
    expect(await panel.controlService("a1", "pm2", "start")).toMatchObject({ name: "pm2", state: "run" });
    await panel.controlService("a1", "postgres", "start");
    await panel.controlService("a1", "crond", "start");
    expect(["pm2", "postgres", "crond"].map((n) => existsSync(down(n)))).toEqual([false, false, true]);
    expect(restarted).toEqual(["pm2", "postgres", "crond"]);
    const audits = db.select().from(auditLog).where(eq(auditLog.action, "service.start")).all();
    expect(audits.map((a) => `${a.actorId}:${a.target}`)).toEqual(["a1:pm2", "a1:postgres", "a1:crond"]);
    // restart never touches the down file
    writeFileSync(down("pm2"), "");
    await panel.controlService("a1", "pm2", "restart");
    expect(existsSync(down("pm2"))).toBe(true);
    db.$client.close();
  });
});
