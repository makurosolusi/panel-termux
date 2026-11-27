import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootPanel, PanelAlreadyRunningError } from "@/server/boot";
import type { Env } from "@/server/env";
import { createFakeSystem } from "@/server/system/system.fake";

const root = mkdtempSync(join(tmpdir(), "panel-guard-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
// test-only: dummy credentials; each case gets its own data dir.
const envFor = (port: number): Env => ({
  APP_BASE_URL: "http://localhost:3200",
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
  SUPER_ADMIN_EMAILS: ["root@example.com"],
  PORT: port,
  PANEL_DATA_DIR: join(root, `data-${++n}`),
  PANEL_SKIP_SNAPSHOT: false,
});
const untouched = (env: Env) => !existsSync(env.PANEL_DATA_DIR) || readdirSync(env.PANEL_DATA_DIR).length === 0;

/** Port that refuses connections: bind a free one, then release it. */
function freePort(): number {
  const s = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = s.port as number;
  s.stop(true);
  return port;
}

async function bootRejection(env: Env): Promise<PanelAlreadyRunningError> {
  const err = await bootPanel(env, { system: createFakeSystem({ home: join(root, "home") }) }).catch((e) => e);
  expect(err).toBeInstanceOf(PanelAlreadyRunningError);
  return err as PanelAlreadyRunningError;
}

describe("instance guard (PLAN/07 §2.4, D2)", () => {
  test("a panel answering /api/health on PORT → refused with its version, data dir untouched", async () => {
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: true, version: "0.4.0" }),
    });
    const env = envFor(fake.port as number);
    try {
      const err = await bootRejection(env);
      expect(err.runningVersion).toBe("0.4.0");
      expect(err.message).toBe(`port ${fake.port} sudah dipakai oleh panel v0.4.0; tidak ada yang diubah`);
      expect(untouched(env)).toBe(true);
    } finally {
      fake.stop(true);
    }
  });

  test("another HTTP server on PORT → refused without a version", async () => {
    const fake = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("nginx", { status: 404 }) });
    const env = envFor(fake.port as number);
    try {
      expect((await bootRejection(env)).runningVersion).toBeNull();
      expect(untouched(env)).toBe(true);
    } finally {
      fake.stop(true);
    }
  });

  test("a listener that accepts but never answers → refused after ~1 s", async () => {
    const silent = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const env = envFor(silent.port);
    try {
      const t0 = Date.now();
      await bootRejection(env);
      expect(Date.now() - t0).toBeLessThan(3000);
      expect(untouched(env)).toBe(true);
    } finally {
      silent.stop(true);
    }
  });

  test("nothing listens on PORT → boots normally", async () => {
    const env = envFor(freePort());
    const exits: number[] = [];
    const { server, shutdown } = await bootPanel(env, {
      system: createFakeSystem({ home: join(root, "home") }),
      exit: (c) => exits.push(c),
    });
    expect(server.port).toBe(env.PORT);
    expect(existsSync(join(env.PANEL_DATA_DIR, "panel.db"))).toBe(true);
    // The booted panel itself now trips the guard for a second instance.
    const second = envFor(env.PORT);
    expect((await bootRejection(second)).runningVersion).toEqual(expect.any(String));
    await shutdown("SIGTERM");
    expect(exits).toEqual([0]);
  });
});
