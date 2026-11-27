// QA fix-04 follow-ups on the fake system: apps.json rebuild (R&D/07 #7), the checked pm2 restart's expected set and
// repeat POST (MAJOR-1, BLOCKER-1), and fake DNS without a token (MAJOR-3).
import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { site } from "@/server/db/schema";
import { panelAppEntry } from "@/server/deploy/run.script";
import { setSetting } from "@/server/settings.service";
import { listFixBackups } from "@/server/sites/fix.backup";
import type { FixPreview, FixResult, Pm2RestartResult } from "@/shared/fix.types";
import type { Integration, Job } from "@/shared/site.types";
import { siteHarness } from "./site.harness";

const POLL = { intervalMs: 5, timeoutMs: 60 }; // test-only: the real check waits up to 30 s
const SECRET = "0123456789abcdef".repeat(4); // test-only: the harness secret
const node = Bun.which("node");

/** A managed site row whose folder has `files` (e.g. run + app). */
function addSite(h: ReturnType<typeof siteHarness>, name: string, port: number, files: string[]): string {
  const dir = join(h.home, "sites", name);
  mkdirSync(dir, { recursive: true });
  for (const f of files) writeFileSync(join(dir, f), "#!/bin/sh\n");
  h.db.insert(site).values({ name, port, runtime: "native", managed: true, dir }).run();
  return dir;
}

const h = siteHarness({ fake: { integration: "poco" }, pm2RestartPoll: POLL });
const audit = (action: string) =>
  h.db.$client.query("SELECT meta FROM audit_log WHERE action = ?").all(action) as { meta: string }[];

describe.skipIf(!node)("apps_json_rebuild", () => {
  test("corrupt apps.json → one fix; rebuilt from runnable managed sites; backup; undo puts the bytes back", async () => {
    const blog = addSite(h, "blog", 3101, ["run", "app"]);
    addSite(h, "draft", 3102, ["run"]); // no binary yet: left out (D5)
    const broken = '[{"name": "blog", "env": {"DATABASE_URL": "postgresql://u:hunter2pass@127.0.0.1/b"}'; // test-only
    writeFileSync(h.appsJson, broken);
    const i = await h.json<Integration>(await h.call("POST", "/integration/verify"));
    expect(i.checks?.find((c) => c.key === "apps_json")).toMatchObject({
      state: "error",
      params: { reason: "invalid" },
    });
    expect(i.fixes?.[0]).toEqual({ key: "apps_json_rebuild", checks: ["apps_json"], available: true });

    const p = await h.json<FixPreview>(await h.call("POST", "/integration/fixes/apps_json_rebuild/preview"));
    expect(p.effects).toMatchObject({ addApps: ["blog"], appliesOnRestart: true });
    expect(p.files[0]).toMatchObject({ file: "apps_json", path: h.appsJson });
    expect(JSON.stringify(p.files[0]?.changes)).not.toContain("hunter2pass");

    const expect_ = Object.fromEntries(p.files.map((f) => [f.path, f.sha]));
    const r = await h.json<FixResult>(
      await h.call("POST", "/integration/fixes/apps_json_rebuild", { expect: expect_ }),
    );
    expect(r.outcome).toBe("applied");
    expect(JSON.parse(readFileSync(h.appsJson, "utf8"))).toEqual([panelAppEntry("blog", blog)]);
    expect(r.integration.checks?.find((c) => c.key === "apps_json")?.state).toBe("ok");
    const [backup] = listFixBackups(h.dir, "apps_json");
    expect(readFileSync(backup?.path as string, "utf8")).toBe(broken);
    expect(r.integration.lastFixes?.[0]).toMatchObject({ file: "apps_json", affectedSites: ["blog"] });
    expect(audit("integration.fix").at(-1)?.meta).not.toContain("hunter2pass");

    const back = await h.json<FixResult>(await h.call("POST", `/integration/backups/${backup?.id}/restore`, {}));
    expect(back.outcome).toBe("restored");
    expect(readFileSync(h.appsJson, "utf8")).toBe(broken);
    writeFileSync(h.appsJson, "[]\n");
  });
});

describe.skipIf(!node)("checked pm2 restart", () => {
  test("two POSTs at once (a resent request) → one restart, both get its result", async () => {
    const before = audit("service.restart").length;
    const [a, b] = await Promise.all([
      h.call("POST", "/integration/pm2/restart"),
      h.call("POST", "/integration/pm2/restart"),
    ]);
    const ra = await h.json<Pm2RestartResult>(a);
    expect(await h.json<Pm2RestartResult>(b)).toEqual(ra);
    expect(audit("service.restart").length).toBe(before + 1);
  });

  test("a runnable apps.json site that is not running counts as missing, not only apps that ran before", async () => {
    const dir = join(h.home, "sites", "blog");
    writeFileSync(h.appsJson, `${JSON.stringify([panelAppEntry("blog", dir)])}\n`);
    const r = await h.json<Pm2RestartResult>(await h.call("POST", "/integration/pm2/restart"));
    expect(r).toMatchObject({ ok: false, missing: ["blog"] });
    writeFileSync(h.appsJson, "[]\n");
  });
});

const dnsH = siteHarness({ fake: { integration: "poco", offline: true }, defaultDns: true });

describe("fake DNS without a token", () => {
  const create = (name: string, hostname: string) =>
    dnsH.startJob("POST", "/sites", { name, hostname, database: false });
  const dnsStep = (j: Job) => j.steps.find((s) => s.key === "dns");

  test("no token: dnsMode cloudflared; out-of-zone name → dns_wrong_zone skipped; in-zone → dns_routed", async () => {
    const i = await dnsH.json<Integration>(await dnsH.call("GET", "/integration"));
    expect(i.dnsMode).toBe("cloudflared");
    const out = await create("warung", "warung.lain.org");
    expect(dnsStep(out)).toMatchObject({ status: "skipped", code: "dns_wrong_zone" });
    expect(out.status).toBe("succeeded");
    expect(dnsStep(await create("kedai", "kedai.contoh.com"))).toMatchObject({ code: "dns_routed" });
  });

  test("token set → dnsMode token and the offline fake creates the record", async () => {
    setSetting({ db: dnsH.db, secret: SECRET }, "cloudflare.api_token", "x".repeat(40), "s1"); // test-only
    const i = await dnsH.json<Integration>(await dnsH.call("POST", "/integration/verify"));
    expect(i.dnsMode).toBe("token");
    expect(dnsStep(await create("toko", "toko.lain.org"))).toMatchObject({ code: "dns_created" });
  });
});
