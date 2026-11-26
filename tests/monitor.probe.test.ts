import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { site } from "@/server/db/schema";
import { createMonitor } from "@/server/monitor/monitor.service";
import { createFakeSystem } from "@/server/system/system.fake";

const dir = mkdtempSync(join(tmpdir(), "panel-probe-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("Cek ulang of a panel site's domain resolves to the site, though its pm2 entry has no PORT", async () => {
  const home = join(dir, "home");
  const toko = join(home, "sites", "toko");
  mkdirSync(toko, { recursive: true });
  mkdirSync(join(home, ".cloudflared"), { recursive: true });
  writeFileSync(join(toko, "run"), "#!/bin/sh\n");
  // A panel apps.json entry: no env PORT (the run script reads .env), so pm2 reports no port for it.
  writeFileSync(join(home, "sites", "apps.json"), JSON.stringify([{ name: "toko", cwd: toko, script: "./run" }]));
  writeFileSync(
    join(home, ".cloudflared", "config.yml"),
    "tunnel: t\ningress:\n  - hostname: toko.contoh.test\n    service: http://localhost:3010\n  - service: http_status:404\n",
  );
  const db = openDb(dir);
  runMigrations(db);
  db.insert(site)
    .values({ name: "toko", port: 3010, app: null, database: null, runtime: "native", managed: true, dir: toko })
    .run();
  const monitor = createMonitor({
    db,
    secret: "test-only-secret-0123456789abcdef",
    system: createFakeSystem({ home }),
    backupStatus: () => ({}) as never,
    securityStatus: () => ({}) as never,
    jobs: () => [],
    adminSeenSinceBoot: () => false,
    appBaseUrl: "http://panel.test",
    panelPort: 3200,
    bootNotice: { cleanShutdown: true, uptimeSec: 60 },
  });
  const d = await monitor.probeDomain("toko.contoh.test");
  expect(d).toMatchObject({ app: "toko", site: "toko", target: "app" });
  db.$client.close();
});
