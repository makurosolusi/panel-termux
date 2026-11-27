// In-UI integration fixes through the API on the fake `poco` scenario (PLAN/06 §9, §10 criteria 1–4, 7).
import { describe, expect, spyOn, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApiHandler } from "@/server/http/api.handler";
import { ApiError } from "@/server/routes/http.error";
import { ecosystemBlock } from "@/server/sites/ecosystem.patch";
import { listFixBackups } from "@/server/sites/fix.backup";
import type { FixPreview, FixResult, Pm2RestartResult } from "@/shared/fix.types";
import type { App } from "@/shared/panel.types";
import type { Integration } from "@/shared/site.types";
import { siteHarness } from "./site.harness";

const POLL = { intervalMs: 5, timeoutMs: 60 }; // test-only: the real check waits up to 30 s
const h = siteHarness({ fake: { integration: "poco" }, pm2RestartPoll: POLL });
const { home, call, json } = h;
const eco = join(home, "sites", "ecosystem.config.js");
const run = join(home, "usr", "var", "service", "pm2", "run");
const node = Bun.which("node");

const integration = async () => json<Integration>(await call("POST", "/integration/verify"));
const state = (i: Integration, key: string) => i.checks?.find((c) => c.key === key);
const preview = async (key: string) => json<FixPreview>(await call("POST", `/integration/fixes/${key}/preview`));
const expectOf = (p: FixPreview) => Object.fromEntries(p.files.map((f) => [f.path, f.sha]));
const apply = async (key: string, status = 200) => {
  const p = await preview(key);
  return json<FixResult>(await call("POST", `/integration/fixes/${key}`, { expect: expectOf(p) }), status);
};
const audit = (action: string) =>
  h.db.$client.query("SELECT target, meta FROM audit_log WHERE action = ? ORDER BY rowid").all(action) as {
    target: string;
    meta: string;
  }[];
const pids = async () =>
  Object.fromEntries((await json<App[]>(await call("GET", "/apps"))).map((a) => [a.name, a.pid]));

describe.skipIf(!node)("integration fixes API (fake poco)", () => {
  let original: Buffer;

  test("roles and CSRF: user 403, no X-Requested-With 403", async () => {
    original = readFileSync(eco);
    expect((await call("POST", "/integration/fixes/ecosystem_block/preview", undefined, h.userCookie)).status).toBe(
      403,
    );
    // The CSRF guard wraps the routes in createApiHandler (as in production).
    const res = await createApiHandler(h.api, { appBaseUrl: "http://localhost" })(
      new Request("http://localhost/api/panel/integration/pm2/restart", {
        method: "POST",
        headers: { origin: "http://localhost", cookie: h.admin },
      }),
    );
    expect(res.status).toBe(403);
    expect(audit("service.restart")).toEqual([]);
  });

  test("poco card: one root error + one warning, two fixes, snippet_current hidden", async () => {
    const i = await integration();
    expect(state(i, "ecosystem_spreads_apps_json")).toMatchObject({ state: "error", params: { noSites: 1 } });
    expect(state(i, "pm2_auto_exit")?.state).toBe("warning");
    expect(state(i, "snippet_current")).toBeUndefined();
    expect(i.ready).toBe(false);
    expect(i.fixes).toEqual([
      { key: "ecosystem_block", checks: ["ecosystem_spreads_apps_json"], available: true },
      { key: "pm2_auto_exit", checks: ["pm2_auto_exit"], available: true },
    ]);
    expect(i.lastFix).toBeNull();
    expect(i.appNames).toEqual(["makuro-solusi", "adminneo"]);
  });

  test("preview writes nothing and names the kept apps; unknown key 404", async () => {
    const mtime = statSync(eco).mtimeMs;
    const p = await preview("ecosystem_block");
    expect(p.effects).toMatchObject({ keepApps: ["makuro-solusi", "adminneo"], guard: false, oldSpread: false });
    expect(p.files).toHaveLength(1);
    const sha = new Bun.CryptoHasher("sha256").update(original).digest("hex");
    expect(p.files[0]).toMatchObject({ file: "ecosystem", path: realpathSync(eco), sha });
    expect(p.files[0]?.changes[0]).toMatchObject({
      kind: "add",
      afterLine: original.toString().split("\n").length - 1,
    });
    expect(statSync(eco).mtimeMs).toBe(mtime);
    expect(existsSync(join(h.dir, "fix-backups"))).toBe(false);
    expect(await json(await call("POST", "/integration/fixes/nope/preview"), 404)).toMatchObject({
      error: "not_found",
    });
  });

  test("busy: a site job or a backup → 409 busy, nothing written", async () => {
    const backup = h.api.decorator.backup;
    const busy = spyOn(backup, "busy").mockReturnValue(true);
    try {
      expect(await apply("ecosystem_block", 409)).toMatchObject({ error: "busy" });
    } finally {
      busy.mockRestore();
    }
    const idle = spyOn(h.api.decorator.siteJobs, "assertIdle").mockImplementation(() => {
      throw new ApiError(409, "busy", "another site job is running");
    });
    try {
      expect(await json(await call("POST", "/integration/pm2/restart"), 409)).toMatchObject({ error: "busy" });
    } finally {
      idle.mockRestore();
    }
    expect(readFileSync(eco).equals(original)).toBe(true);
  });

  test("file edited between preview and apply → 409 changed, file untouched", async () => {
    const p = await preview("ecosystem_block");
    appendFileSync(eco, "// edited on the phone\n");
    const edited = readFileSync(eco);
    const r = await call("POST", "/integration/fixes/ecosystem_block", { expect: expectOf(p) });
    expect(await json(r, 409)).toMatchObject({ error: "changed" });
    expect(readFileSync(eco).equals(edited)).toBe(true);
    writeFileSync(eco, original);
  });

  test("apply ecosystem: original bytes + block, mode kept, backup, no pm2 call, audit without content", async () => {
    const before = await pids();
    const pm2 = h.system.pm2;
    const spies = [
      spyOn(pm2, "control"),
      spyOn(pm2, "remove"),
      spyOn(pm2, "startFromEcosystem"),
      spyOn(h.system.runit, "control"),
    ];
    let r: FixResult;
    try {
      r = await apply("ecosystem_block");
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
    expect(r.outcome).toBe("applied");
    const now = readFileSync(eco);
    expect(now.subarray(0, original.length).equals(original)).toBe(true);
    expect(now.subarray(original.length).toString()).toBe(`\n${ecosystemBlock(join(home, "usr"))}`);
    expect(statSync(eco).mode & 0o777).toBe(0o600);
    const [backup] = listFixBackups(h.dir, "ecosystem");
    expect(readFileSync(backup?.path as string).equals(original)).toBe(true);
    expect(await pids()).toEqual(before);
    expect(state(r.integration, "ecosystem_spreads_apps_json")?.state).toBe("ok");
    expect(state(r.integration, "snippet_current")?.state).toBe("ok");
    expect(r.integration.lastFix).toMatchObject({ id: backup?.id, file: "ecosystem", changedSince: false });
    const [row] = audit("integration.fix");
    expect(JSON.parse(row?.meta as string)).toMatchObject({
      key: "ecosystem_block",
      outcome: "applied",
      backupId: backup?.id,
    });
    expect(row?.meta).not.toContain("makuro");
    expect(row?.meta).not.toContain("module.exports");
  });

  test("apply run script → pm2 ready with pending info; a second apply is unchanged and writes nothing", async () => {
    const r = await apply("pm2_auto_exit");
    expect(readFileSync(run, "utf8")).toContain("pm2-runtime --no-auto-exit ");
    expect(statSync(run).mode & 0o777).toBe(0o755);
    expect(state(r.integration, "pm2_auto_exit")).toMatchObject({ state: "ok", params: { pending: 1 } });
    expect(r.integration.ready).toBe(true);
    expect(r.integration.fixes).toEqual([]);
    const mtime = statSync(eco).mtimeMs;
    const again = await json<FixResult>(await call("POST", "/integration/fixes/ecosystem_block", { expect: {} }));
    expect(again.outcome).toBe("unchanged");
    expect(statSync(eco).mtimeMs).toBe(mtime);
  });

  test("checked pm2 restart: every app back → ok, pending cleared, audited", async () => {
    const r = await json<Pm2RestartResult>(await call("POST", "/integration/pm2/restart"));
    expect(r).toMatchObject({ ok: true, missing: [], offerRestore: null });
    expect(state(r.integration, "pm2_auto_exit")).toMatchObject({ state: "ok", params: {} });
    expect(audit("service.restart").map((a) => a.target)).toEqual(["pm2"]);
    expect(JSON.parse(audit("integration.pm2_restart")[0]?.meta as string)).toEqual({ missing: 0 });
  });

  test("restore: bad ids 404; edited file needs force; restore puts the original back byte for byte", async () => {
    for (const id of ["..%2F..%2Fsecret", "ecosystem.20261127-000000-deadbeef", "pm2_run.x"])
      expect(await json(await call("POST", `/integration/backups/${id}/restore`, {}), 404)).toMatchObject({
        error: "not_found",
      });
    const backup = listFixBackups(h.dir, "ecosystem")[0]?.id as string;
    writeFileSync(join(home, "sites", "apps.json"), JSON.stringify([{ name: "blog", script: "./run" }]));
    const fixed = readFileSync(eco);
    appendFileSync(eco, "// later edit\n");
    expect((await integration()).lastFix).toBeDefined();
    const r409 = await call("POST", `/integration/backups/${backup}/restore`, {});
    expect(await json(r409, 409)).toMatchObject({ error: "changed_since" });
    writeFileSync(eco, fixed);
    // Backup names have 1 s resolution: let the undo backup land in a later second than the fix's own.
    await Bun.sleep(1000 - (Date.now() % 1000) + 5);
    const r = await json<FixResult>(await call("POST", `/integration/backups/${backup}/restore`, {}));
    expect(r).toMatchObject({ key: "restore", outcome: "restored", restart: null });
    expect(readFileSync(eco).equals(original)).toBe(true);
    expect(state(r.integration, "ecosystem_spreads_apps_json")?.state).toBe("error");
    // Undo of the undo: the fixed file was backed up too, and it names the sites a restore would drop.
    expect(r.integration.lastFix).toMatchObject({ file: "ecosystem", changedSince: false, affectedSites: ["blog"] });
    expect(JSON.parse(audit("integration.restore")[0]?.meta as string)).toMatchObject({
      backupId: backup,
      forced: false,
    });
    writeFileSync(join(home, "sites", "apps.json"), "[]\n");
  });
});

const lost = siteHarness({ fake: { integration: "poco", pm2LostOnRestart: ["adminneo"] }, pm2RestartPoll: POLL });
const lostEco = join(lost.home, "sites", "ecosystem.config.js");

describe.skipIf(!node)("checked pm2 restart when an app does not come back", () => {
  test("missing app reported with a restore offer; restore + restart brings back the old file", async () => {
    const original = readFileSync(lostEco);
    const p = await lost.json<FixPreview>(await lost.call("POST", "/integration/fixes/ecosystem_block/preview"));
    const expect_ = Object.fromEntries(p.files.map((f) => [f.path, f.sha]));
    await lost.json(await lost.call("POST", "/integration/fixes/ecosystem_block", { expect: expect_ }));
    const id = listFixBackups(lost.dir, "ecosystem")[0]?.id;
    const r = await lost.json<Pm2RestartResult>(await lost.call("POST", "/integration/pm2/restart"));
    expect(r).toMatchObject({ ok: false, missing: ["adminneo"], offerRestore: id });
    const back = await lost.json<FixResult>(
      await lost.call("POST", `/integration/backups/${id}/restore`, { restart: true, force: true }),
    );
    expect(readFileSync(lostEco).equals(original)).toBe(true);
    expect(back.restart).toMatchObject({ ok: true, offerRestore: null });
    expect(back.integration).toEqual(back.restart?.integration as Integration);
  });
});
