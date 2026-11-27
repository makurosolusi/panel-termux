import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ecosystemBlock } from "@/server/sites/ecosystem.patch";
import { PROBE_ENV_KEYS } from "@/server/sites/ecosystem.probe";
import { siteSecretsFor } from "@/server/sites/site.secrets";
import { fakeEcosystem } from "@/server/system/system.fake";
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
/** Ecosystem with the guard, `extra` apps (JS source) and the current panel block. */
const snippetEco = (extra = "") =>
  `module.exports = { apps: [{ name: "pm2-guard", script: "/bin/sleep", args: "infinity" },${extra}] };\n${ecosystemBlock(join(home, "usr"))}`;

describe.skipIf(!node)("integration checks (real node probe)", () => {
  test("GET never writes; 0.2.x ecosystem without apps.json → not ready, reasons coded", async () => {
    // the fake sandbox now ships the current template: put the 0.2.x block back for this upgrade scenario
    writeFileSync(eco, 'module.exports = { apps: [...require("./apps.json")] };\n');
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
    expect(i.snippet).toBe(ecosystemBlock(join(home, "usr")));
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
    expect(states(ok)).toMatchObject({ snippet_current: "ok", apps_entries_runnable: "ok" });
    expect(ok.appNames).toEqual(["pm2-guard"]);
    expect(ok.ecosystemIncludesAppsJson).toBe(true);
    writeFileSync(appsJson, JSON.stringify([{ name: "blog", cwd: join(home, "sites", "blog"), script: "./run" }]));
    const warn = await verify();
    expect(warn.ready).toBe(true);
    expect(checkOf(warn, "apps_entries_runnable")).toMatchObject({ state: "warning", params: { count: 1 } });
    writeFileSync(appsJson, "[]\n");
  });

  test("pm2_auto_exit reads the sandbox's runit script in fake mode, not the host $PREFIX", async () => {
    expect(system.prefix).toBe(join(home, "usr"));
    expect(checkOf(await verify(), "pm2_auto_exit")?.state).toBe("ok");
    // The flag no longer hides pm2_guard (debat C15): with the block, the guard only fails on old files.
    expect(checkOf(await verify(), "pm2_guard")?.state).toBe("ok");
    const run = join(home, "usr", "var", "service", "pm2", "run");
    const shipped = readFileSync(run, "utf8");
    writeFileSync(run, shipped.replace("--no-auto-exit ", ""));
    expect(checkOf(await verify(), "pm2_auto_exit")?.state).toBe("warning");
    expect(checkOf(await verify(), "pm2_guard")).toBeDefined();
    writeFileSync(run, shipped);
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
    await json(await call("POST", "/sites/adopt", { hostname: "solusi.contoh.test", app: "makuro-solusi" }), 201);
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

  test("no ecosystem.config.js → only the root cause, not 'cannot load / old block / no guard'", async () => {
    const before = read(eco);
    rmSync(eco);
    try {
      const i = await verify();
      expect(checkOf(i, "ecosystem_file")?.state).toBe("error");
      for (const key of ["ecosystem_loads", "ecosystem_spreads_apps_json", "snippet_current", "pm2_guard"] as const)
        expect(checkOf(i, key)).toBeUndefined();
      expect(i.ready).toBe(false);
    } finally {
      if (before !== null) writeFileSync(eco, before);
    }
  });

  test("fixes[] per file shape; ready sandbox lists none; appNames = hand apps ∪ runnable panel sites", async () => {
    writeFileSync(eco, fakeEcosystem(home)); // earlier tests leave other files behind
    const before = read(eco);
    const fixture = (n: string) => readFileSync(join(import.meta.dir, "fixtures", "ecosystem", `${n}.config.js`));
    const block = async () => (await verify()).fixes?.find((f) => f.key === "ecosystem_block");
    try {
      expect((await verify()).fixes).toEqual([]);
      writeFileSync(eco, fixture("old-spread"));
      expect(await block()).toMatchObject({ available: true });
      const p = await json<{ effects: { oldSpread: boolean } }>(
        await call("POST", "/integration/fixes/ecosystem_block/preview"),
      );
      expect(p.effects.oldSpread).toBe(true);
      writeFileSync(eco, fixture("latin1"));
      expect(await block()).toMatchObject({ available: false, reason: "not_utf8" });
      writeFileSync(eco, 'throw new Error("boom");\n');
      expect(await block()).toMatchObject({ available: false, reason: "ecosystem_unloadable" });
    } finally {
      if (before !== null) writeFileSync(eco, before);
    }
    const dir = join(home, "sites", "blog");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run"), "#!/bin/sh\n");
    writeFileSync(join(dir, "app"), "x");
    // An entry without a script is dropped by the block, so it is not runnable either (block filter, §3.1).
    writeFileSync(
      appsJson,
      JSON.stringify([
        { name: "blog", cwd: dir, script: "./run" },
        { name: "bare", cwd: dir },
      ]),
    );
    const i = await verify();
    expect(i.appNames).toContain("blog");
    expect(i.appNames).not.toContain("bare");
    expect(checkOf(i, "apps_entries_runnable")).toMatchObject({ state: "warning", params: { count: 1 } });
    writeFileSync(appsJson, "[]\n");
  });
});
