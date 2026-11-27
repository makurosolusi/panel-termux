// restartApp for apps pm2 does not know (PLAN/06 §6.3): adopted → loaded from ecosystem.config.js, or a coded error.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { restartApp } from "@/server/deploy/deploy.restart";
import type { SiteRow } from "@/server/deploy/deploy.steps";
import { StepError } from "@/server/sites/job.step";
import type { SiteCtx } from "@/server/sites/site.checks";
import type { Pm2Adapter, SystemAdapters } from "@/server/system/system.types";
import type { App } from "@/shared/panel.types";

const dir = mkdtempSync(join(tmpdir(), "panel-restart-"));
const db = openDb(dir);
runMigrations(db);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// test-only: a pm2 stub that knows `known` apps; startFromEcosystem answers `loads`.
function ctxWith(known: string[], loads: App | null) {
  const pm2 = {
    list: mock(async () => known.map((name) => ({ name }) as App)),
    startFromEcosystem: mock(async () => loads),
    control: mock(async () => ({ name: "x" }) as App),
    remove: mock(async () => true),
  };
  const system = {
    home: dir,
    pm2: pm2 as unknown as Pm2Adapter,
    cloudflared: { configPath: join(dir, "c.yml") },
  } as unknown as SystemAdapters;
  return { ctx: { db, secret: "s", system } as SiteCtx, pm2 };
}
const row = (over: Partial<SiteRow>) => ({ name: "shop", app: "shop", managed: false, ...over }) as SiteRow;

describe("restartApp", () => {
  test("adopted app unknown to pm2 → startFromEcosystem with the sites ecosystem file", async () => {
    const { ctx, pm2 } = ctxWith([], { name: "shop" } as App);
    expect(await restartApp(ctx, row({}), false)).toEqual({ code: "app_started", params: { name: "shop" } });
    expect(pm2.startFromEcosystem).toHaveBeenCalledWith(join(dir, "sites", "ecosystem.config.js"), "shop");
    expect(pm2.control).not.toHaveBeenCalled();
  });

  test("adopted entry gone from ecosystem.config.js → app_not_in_ecosystem", async () => {
    const { ctx } = ctxWith([], null);
    const err = await restartApp(ctx, row({}), false).catch((e) => e);
    expect(err).toBeInstanceOf(StepError);
    expect(err).toMatchObject({ code: "app_not_in_ecosystem", params: { name: "shop" } });
  });

  test("adopted app pm2 knows → plain pm2 restart", async () => {
    const { ctx, pm2 } = ctxWith(["shop"], null);
    expect(await restartApp(ctx, row({}), false)).toEqual({ code: "app_restarted", params: { name: "shop" } });
    expect(pm2.control).toHaveBeenCalledWith("shop", "restart");
    expect(pm2.startFromEcosystem).not.toHaveBeenCalled();
  });

  test("managed app unknown to pm2 → still reloaded from the panel list", async () => {
    const { ctx, pm2 } = ctxWith([], { name: "shop" } as App);
    expect((await restartApp(ctx, row({ managed: true }), false)).code).toBe("app_started");
    expect(pm2.remove).not.toHaveBeenCalled();
  });
});
