import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { auditLog } from "@/server/db/schema";
import { FAKE_TUNNEL_ID } from "@/server/system/system.fake";
import type { Page } from "@/shared/dev.types";
import type { App } from "@/shared/panel.types";
import type { Integration, Job, Site } from "@/shared/site.types";
import { SECRET_VALUE, siteHarness } from "./site.harness";

const h = siteHarness();
const { home, fakeDns, cfg, appsJson, read, call, json, startJob, stepStatus, dbs } = h;

beforeAll(async () => {
  const j = await startJob("POST", "/sites", {
    name: "shop",
    hostname: "shop.example.test",
    database: true,
    env: { API_SECRET: SECRET_VALUE },
  });
  expect(j.status).toBe("succeeded");
});

describe("adopt, env, hostnames", () => {
  test("adopt records an existing site without system changes", async () => {
    const [cfgBefore, appsBefore] = [read(cfg), read(appsJson)];
    const disc = await json<{ hostname: string; port: number | null; app: string | null }[]>(
      await call("GET", "/sites/discovered"),
    );
    expect(disc).toContainEqual({ hostname: "solusi.example.test", port: 3005, app: "makuro-solusi" });
    const s = await json<Site>(
      await call("POST", "/sites/adopt", {
        name: "solusi",
        hostname: "solusi.example.test",
        port: 3005,
        app: "makuro-solusi",
      }),
      201,
    );
    expect(s).toMatchObject({
      name: "solusi",
      managed: false,
      runtime: "grun",
      appStatus: "online",
      hostnames: ["solusi.example.test"],
    });
    expect(
      (await json<{ hostname: string }[]>(await call("GET", "/sites/discovered"))).map((d) => d.hostname),
    ).not.toContain("solusi.example.test");
    expect(
      await json(await call("POST", "/sites/adopt", { name: "solusi", hostname: "x.example.test", port: 3005 }), 409),
    ).toMatchObject({ error: "exists" });
    expect([read(cfg), read(appsJson)]).toEqual([cfgBefore, appsBefore]);
    expect(h.db.select().from(auditLog).where(eq(auditLog.action, "site.adopt")).all()).toHaveLength(1);
  });

  test("env update returns keys only and restarts a deployed app", async () => {
    const res = await call("PUT", "/sites/shop/env", { set: { NEW_TOKEN: SECRET_VALUE }, unset: ["API_SECRET"] });
    const text = await res.clone().text();
    expect(await json(res)).toEqual({ envKeys: ["PORT", "DATABASE_URL", "NEW_TOKEN"] });
    expect(text).not.toContain("s3cr3t");
    expect(read(join(home, "sites", "shop", ".env"))).toContain("NEW_TOKEN='s3cr3t \\$value with spaces'");
    const meta = h.db.select().from(auditLog).where(eq(auditLog.action, "site.env_update")).get()?.meta;
    expect(meta).toEqual({ set: ["NEW_TOKEN"], unset: ["API_SECRET"] });
    expect(await json(await call("PUT", "/sites/shop/env", { set: { BAD: "it's" } }), 400)).toMatchObject({
      error: "invalid_env",
    });

    // Adopted site with a deployed pm2 app: restart happens.
    mkdirSync(join(home, "sites", "solusi"));
    const restarts = async () =>
      (await json<App[]>(await call("GET", "/apps"))).find((a) => a.name === "makuro-solusi")?.restarts;
    const r0 = await restarts();
    await json(await call("PUT", "/sites/solusi/env", { set: { A: "1" }, unset: [] }));
    expect(await restarts()).toBe((r0 as number) + 1);
  });

  test("hostname add/remove; last hostname refused; hand-written refused", async () => {
    const add = await startJob("POST", "/sites/shop/hostnames", { hostname: "www.shop.example.test" });
    expect(add).toMatchObject({ kind: "hostname.add", target: "shop", status: "succeeded" });
    expect(read(cfg)).toContain("www.shop.example.test\n    service: http://localhost:3002");
    const rm = await startJob("DELETE", "/sites/shop/hostnames/www.shop.example.test");
    expect(rm).toMatchObject({ kind: "hostname.remove", status: "succeeded" });
    expect(read(cfg)).not.toContain("www.shop.example.test");
    expect(fakeDns.records.has("www.shop.example.test")).toBe(false);
    expect(await json(await call("DELETE", "/sites/shop/hostnames/shop.example.test"), 400)).toMatchObject({
      error: "last_hostname",
    });
    await startJob("POST", "/sites/solusi/hostnames", { hostname: "alt.solusi.example.test" });
    expect(await json(await call("DELETE", "/sites/solusi/hostnames/solusi.example.test"), 409)).toMatchObject({
      error: "hand_written",
    });
  });
});

describe("delete", () => {
  test("managed site with keepData: folder kept, db dropped, config entries gone", async () => {
    const j = await startJob("DELETE", "/sites/shop?keepData=true&keepDatabase=false");
    expect(j).toMatchObject({ kind: "site.delete", status: "succeeded" });
    expect(stepStatus(j)).toMatchObject({
      ingress: "done",
      restart: "done",
      dns: "done",
      apps: "done",
      pm2: "skipped",
      database: "done",
      folder: "skipped",
    });
    expect(existsSync(join(home, "sites", "shop", ".env"))).toBe(true);
    expect(await dbs()).not.toContain("shop");
    expect(read(cfg)).not.toContain("shop.example.test");
    expect((JSON.parse(read(appsJson) as string) as { name: string }[]).map((a) => a.name)).not.toContain("shop");
    expect(fakeDns.records.has("shop.example.test")).toBe(false);
    expect(await json(await call("GET", "/sites/shop"), 404)).toMatchObject({ error: "not_found" });
  });

  test("keepDatabase keeps the db and removes the folder", async () => {
    const created = await startJob("POST", "/sites", {
      name: "keepdb",
      hostname: "keepdb.example.test",
      database: true,
    });
    expect(created.status).toBe("succeeded");
    expect((await startJob("DELETE", "/sites/keepdb?keepDatabase=true")).status).toBe("succeeded");
    expect(await dbs()).toContain("keepdb");
    expect(existsSync(join(home, "sites", "keepdb"))).toBe(false);
  });

  test("adopted site: only panel-added ingress removed, hand-written rule and pm2 untouched", async () => {
    const j = await startJob("DELETE", "/sites/solusi");
    expect(j.status).toBe("succeeded");
    expect(stepStatus(j)).toMatchObject({ apps: "skipped", pm2: "skipped", database: "skipped", folder: "skipped" });
    const text = read(cfg) as string;
    expect(text).toContain("solusi.example.test\n    service: http://localhost:3005");
    expect(text).not.toContain("alt.solusi.example.test");
    expect((await json<App[]>(await call("GET", "/apps"))).map((a) => a.name)).toContain("makuro-solusi");
  });
});

describe("jobs + integration", () => {
  test("jobs paged newest first; unknown → 404", async () => {
    const p = await json<Page<Job>>(await call("GET", "/jobs?pageSize=2"));
    expect(p).toMatchObject({ page: 1, pageSize: 2 });
    expect(p.items).toHaveLength(2);
    expect(p.total).toBeGreaterThan(5);
    expect(p.items[0]?.kind).toBe("site.delete");
    expect(await json(await call("GET", "/jobs/nope"), 404)).toMatchObject({ error: "not_found" });
  });

  test("integration status", async () => {
    expect(await json<Integration>(await call("GET", "/integration"))).toEqual({
      ecosystemIncludesAppsJson: true,
      appsJsonExists: true,
      tunnelId: FAKE_TUNNEL_ID,
      cloudflareTokenSet: false,
      issues: ["Cloudflare API token not set (/dev settings): DNS records will be skipped"],
    });
  });
});
