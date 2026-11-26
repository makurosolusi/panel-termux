import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROBE_ENV_KEYS } from "@/server/sites/ecosystem.probe";
import { ECOSYSTEM_SNIPPET } from "@/server/sites/integration.service";
import { siteSecretsFor } from "@/server/sites/site.secrets";
import type { Integration, IntegrationCheck, SiteDetail } from "@/shared/site.types";
import { fakeElf, GLIBC_LINKER } from "./deploy.fixture";
import { siteHarness } from "./site.harness";

const h = siteHarness();
const { home, system, appsJson, read, call, json } = h;
const eco = join(home, "sites", "ecosystem.config.js");
const node = Bun.which("node");

const verify = async () => json<Integration>(await call("POST", "/integration/verify"));
const states = (i: Integration) =>
  Object.fromEntries((i.checks ?? []).map((c) => [c.key, c.state])) as Record<IntegrationCheck["key"], string>;
const checkOf = (i: Integration, key: IntegrationCheck["key"]) => i.checks?.find((c) => c.key === key);
/** Ecosystem with the current snippet, the guard and `extra` apps (JS source). */
const snippetEco = (extra = "") =>
  `${ECOSYSTEM_SNIPPET}\nmodule.exports = { apps: [{ name: "pm2-guard", script: "/bin/sleep", args: "infinity" },${extra} ...panelApps] };\n`;

describe.skipIf(!node)("integration checks (real node probe)", () => {
  test("GET never writes; 0.2.x ecosystem without apps.json → not ready, reasons coded", async () => {
    const i = await json<Integration>(await call("GET", "/integration"));
    expect(read(appsJson)).toBeNull();
    expect(i.ready).toBe(false);
    expect(states(i)).toMatchObject({
      sites_dir: "ok",
      apps_json: "error",
      ecosystem_file: "ok",
      ecosystem_loads: "error",
      snippet_current: "error",
      pm2_runtime: "ok",
      tunnel: "ok",
      cloudflare_token: "warning",
    });
    expect(checkOf(i, "apps_json")?.params).toEqual({ reason: "missing" });
    expect(checkOf(i, "ecosystem_loads")?.params).toEqual({ reason: "syntax" });
    expect(i.snippet).toBe(ECOSYSTEM_SNIPPET);
    expect(i.ecosystemPath).toBe(eco);
    // 0.2.x fields stay for the current web.
    expect(i).toMatchObject({ ecosystemIncludesAppsJson: false, appsJsonExists: false, cloudflareTokenSet: false });
    expect(i.issues?.length).toBeGreaterThan(0);
  });

  test("verify creates apps.json [] once, never overwrites it", async () => {
    const i = await verify();
    expect(read(appsJson)).toBe("[]\n");
    expect(states(i)).toMatchObject({ apps_json: "ok", ecosystem_loads: "ok", ecosystem_spreads_apps_json: "ok" });
    expect(states(i).snippet_current).toBe("error"); // old `...require("./apps.json")` block
    expect(i.ready).toBe(false);
    writeFileSync(appsJson, '[{"name":"x","script":"/bin/sh"}]');
    await verify();
    expect(read(appsJson)).toBe('[{"name":"x","script":"/bin/sh"}]');
    writeFileSync(appsJson, "[]\n");
  });

  test("current snippet + guard → ready; an entry without its binary only warns", async () => {
    writeFileSync(eco, snippetEco());
    const ok = await verify();
    expect(ok.ready).toBe(true);
    expect(states(ok)).toMatchObject({ snippet_current: "ok", pm2_guard: "ok", apps_entries_runnable: "ok" });
    expect(ok.appNames).toEqual(["pm2-guard"]);
    expect(ok.ecosystemIncludesAppsJson).toBe(true);
    writeFileSync(appsJson, JSON.stringify([{ name: "blog", cwd: join(home, "sites", "blog"), script: "./run" }]));
    const warn = await verify();
    expect(warn.ready).toBe(true);
    expect(checkOf(warn, "apps_entries_runnable")).toMatchObject({ state: "warning", params: { count: 1 } });
    writeFileSync(appsJson, "[]\n");
  });

  test("pm2 not running → pm2_runtime error, not ready; GET is cached ≤ 30 s, verify refreshes", async () => {
    const before = await json<Integration>(await call("GET", "/integration"));
    await system.runit.control("pm2", "stop");
    try {
      expect((await json<Integration>(await call("GET", "/integration"))).checkedAt).toBe(before.checkedAt);
      const i = await verify();
      expect(checkOf(i, "pm2_runtime")).toMatchObject({ state: "error", params: { reason: "service_down" } });
      expect(i.ready).toBe(false);
    } finally {
      await system.runit.control("pm2", "start");
    }
    expect((await verify()).ready).toBe(true);
  });

  test("probe child sees only PATH/HOME/PREFIX/PM2_HOME/LANG; envKeys are names only", async () => {
    const out = join(h.dir, "probe-env.json");
    writeFileSync(
      eco,
      `require("fs").writeFileSync(${JSON.stringify(out)}, JSON.stringify(Object.keys(process.env)));\n${snippetEco(
        ' { name: "makuro-solusi", script: "/bin/sh", env: { NODE_ENV: "production", API_TOKEN: "tok-value-123" } },',
      )}`,
    );
    process.env.PANEL_TEST_LEAK = "must-not-reach-probe"; // test-only
    try {
      await verify();
    } finally {
      delete process.env.PANEL_TEST_LEAK;
    }
    // macOS itself adds __CF_USER_TEXT_ENCODING to every process; nothing else may come from the panel.
    const keys = (JSON.parse(readFileSync(out, "utf8")) as string[]).filter((k) => k !== "__CF_USER_TEXT_ENCODING");
    expect(keys.filter((k) => !(PROBE_ENV_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect(keys).toContain("HOME");

    // Adopted site: the pm2 entry's env keys (they override .env, E6b) are listed; values never.
    const dir = join(home, "sites", "makuro-solusi");
    writeFileSync(join(dir, "app"), fakeElf({ interp: GLIBC_LINKER }));
    writeFileSync(join(dir, ".env"), "PORT=3005\nAPI_TOKEN=dotenv-secret-456\n");
    await json(await call("POST", "/sites/adopt", { hostname: "solusi.example.test", app: "makuro-solusi" }), 201);
    const res = await call("GET", "/sites/makuro-solusi");
    const text = await res.clone().text();
    expect((await json<SiteDetail>(res)).pm2EnvKeys).toEqual(["NODE_ENV", "API_TOKEN"]);
    expect(text).not.toContain("tok-value-123");
    expect(text).not.toContain("dotenv-secret-456");
    expect(siteSecretsFor(h.db, "makuro-solusi")).toEqual(["dotenv-secret-456"]);
    expect(siteSecretsFor(h.db, "nope")).toEqual([]);
  });

  test("ecosystem that throws → ecosystem_loads error with a short redacted detail", async () => {
    writeFileSync(eco, 'throw new Error("boom in ecosystem");\n');
    const i = await verify();
    const c = checkOf(i, "ecosystem_loads");
    expect(c).toMatchObject({ state: "error", params: { reason: "syntax" } });
    expect(c?.detail).toContain("boom in ecosystem");
    expect((c?.detail ?? "").length).toBeLessThanOrEqual(300);
    expect(i.ready).toBe(false);
  });
});
