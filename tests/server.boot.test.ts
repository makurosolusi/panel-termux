import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { bootPanel } from "@/server/boot";
import { openDb } from "@/server/db/client";
import { appMeta, auditLog } from "@/server/db/schema";
import { type Env, parseEnv } from "@/server/env";
import { CLEAN_SHUTDOWN_MARKER } from "@/server/shutdown";
import { createFakeSystem } from "@/server/system/system.fake";
import pkg from "../package.json" with { type: "json" };

const root = mkdtempSync(join(tmpdir(), "panel-boot-"));
const dataDir = join(root, "data");
const home = join(root, "home");
afterAll(() => rmSync(root, { recursive: true, force: true }));

// test-only: dummy credentials, port 0 = any free port (env.ts would refuse 0; bootPanel takes the parsed value).
const env: Env = {
  APP_BASE_URL: "http://localhost:3200",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
  SUPER_ADMIN_EMAILS: ["root@example.com"],
  PORT: 0,
  PANEL_DATA_DIR: dataDir,
  PANEL_SKIP_SNAPSHOT: false,
};

const snapshots = () => (existsSync(join(dataDir, "snapshots")) ? readdirSync(join(dataDir, "snapshots")) : []);
const starts = () => {
  const db = openDb(dataDir);
  const rows = db.select().from(auditLog).where(eq(auditLog.action, "panel.start")).all();
  db.$client.close();
  return rows.map((r) => r.meta);
};

/** Boots, checks /api/health over HTTP, then shuts down gracefully (marker written, DB closed). */
async function bootOnce() {
  const exits: number[] = [];
  const { server, shutdown } = await bootPanel(env, { system: createFakeSystem({ home }), exit: (c) => exits.push(c) });
  const health = (await (await fetch(`http://127.0.0.1:${server.port}/api/health`)).json()) as { bootId: string };
  const anon = await fetch(`http://127.0.0.1:${server.port}/api/panel/overview`);
  await shutdown("SIGTERM");
  expect(exits).toEqual([0]);
  return { health, anonStatus: anon.status };
}

describe("boot (PLAN/04 F6/F7)", () => {
  test("fresh install: no snapshot, panel_version written, panel.start audited, marker on shutdown", async () => {
    const { health, anonStatus } = await bootOnce();
    expect(health.bootId).toMatch(/^[0-9a-f-]{36}$/);
    expect(anonStatus).toBe(401);
    expect(snapshots()).toEqual([]);
    expect(existsSync(join(dataDir, CLEAN_SHUTDOWN_MARKER))).toBe(true);
    const db = openDb(dataDir);
    expect(db.select().from(appMeta).where(eq(appMeta.key, "panel_version")).get()?.value).toBe(pkg.version);
    db.$client.close();
    expect(starts()).toEqual([{ version: pkg.version, schema: expect.any(String), snapshot: null }]);
    // sites.dir (~/sites in the fake home) exists → apps.json `[]` was written at boot.
    expect(await Bun.file(join(home, "sites", "apps.json")).text()).toBe("[]\n");
  });

  test("a pending migration is snapshotted once; booting again with nothing pending adds none", async () => {
    const db = openDb(dataDir);
    db.$client.run(
      "DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)",
    );
    db.$client.close();

    await bootOnce();
    const after = snapshots();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatch(new RegExp(`^panel\\.db\\.${pkg.version.replaceAll(".", "\\.")}\\.\\d{14}$`));
    expect(starts().at(-1)?.snapshot).toBe(after[0]);
    // The marker from the previous shutdown was consumed by this boot and rewritten by its shutdown.
    expect(existsSync(join(dataDir, CLEAN_SHUTDOWN_MARKER))).toBe(true);

    await bootOnce();
    expect(snapshots()).toEqual(after);
    expect(starts()).toHaveLength(3);
  });
});

describe("env (0.3.0 additions)", () => {
  const base = {
    APP_BASE_URL: "https://panel.example.com",
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "csecret",
    SUPER_ADMIN_EMAILS: "a@example.com",
  };
  test("PANEL_CONNECTIVITY_URL optional and validated; PANEL_SKIP_SNAPSHOT only on 1", () => {
    expect(parseEnv(base).PANEL_CONNECTIVITY_URL).toBeUndefined();
    expect(parseEnv(base).PANEL_SKIP_SNAPSHOT).toBe(false);
    const e = parseEnv({ ...base, PANEL_CONNECTIVITY_URL: "http://10.0.0.1/ok", PANEL_SKIP_SNAPSHOT: "1" });
    expect(e.PANEL_CONNECTIVITY_URL).toBe("http://10.0.0.1/ok");
    expect(e.PANEL_SKIP_SNAPSHOT).toBe(true);
    expect(parseEnv({ ...base, PANEL_SKIP_SNAPSHOT: "true" }).PANEL_SKIP_SNAPSHOT).toBe(false);
    expect(() => parseEnv({ ...base, PANEL_CONNECTIVITY_URL: "ftp://x" })).toThrow("PANEL_CONNECTIVITY_URL");
  });
});
