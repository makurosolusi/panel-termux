// Integration fix edge cases (PLAN/06 §3.4, §6.2, §9 `ecosystem.fix`): failed validation, I/O errors, linked files,
// edits during the fix, orphan candidates, sites_dir_create. Real node probe, fake system in a temp sandbox.
import { describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  copyFileSync,
  existsSync,
  linkSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setSetting } from "@/server/settings.service";
import { ECOSYSTEM_CANDIDATE } from "@/server/sites/ecosystem.patch";
import { listFixBackups } from "@/server/sites/fix.backup";
import type { FixPreview } from "@/shared/fix.types";
import type { Integration } from "@/shared/site.types";
import { siteHarness } from "./site.harness";

const h = siteHarness({ fake: { integration: "poco" } });
const { home, call, json } = h;
const sites = join(home, "sites");
const eco = join(sites, "ecosystem.config.js");
const fixture = (name: string) => join(import.meta.dir, "fixtures", "ecosystem", `${name}.config.js`);
const node = Bun.which("node");
const SECRET = "0123456789abcdef".repeat(4); // test-only: the harness secret
const ADMIN_ID = "s1"; // test-only: the harness admin (first user it adds)

const preview = (key = "ecosystem_block") => call("POST", `/integration/fixes/${key}/preview`);
async function apply(key = "ecosystem_block"): Promise<Response> {
  const p = await json<FixPreview>(await preview(key));
  return call("POST", `/integration/fixes/${key}`, { expect: Object.fromEntries(p.files.map((f) => [f.path, f.sha])) });
}
const lastAudit = () =>
  JSON.parse(
    (
      h.db.$client.query("SELECT meta FROM audit_log WHERE action = 'integration.fix' ORDER BY rowid DESC").get() as {
        meta: string;
      }
    ).meta,
  );
const ioError = (code: string) => Object.assign(new Error(`${code}: injected`), { code });

describe.skipIf(!node)("ecosystem fix edge cases", () => {
  test("function export: block cannot run → 422 validation_failed, file byte-identical, audited", async () => {
    copyFileSync(fixture("exports-function"), eco);
    const before = readFileSync(eco);
    const body = await json<{ error: string; detail: string }>(await apply(), 422);
    expect(body.error).toBe("validation_failed");
    expect(body.detail.length).toBeLessThanOrEqual(300);
    expect(readFileSync(eco).equals(before)).toBe(true);
    expect(existsSync(join(sites, ECOSYSTEM_CANDIDATE))).toBe(false);
    expect(listFixBackups(h.dir, "ecosystem")).toEqual([]);
    expect(lastAudit()).toMatchObject({ key: "ecosystem_block", outcome: "validation_failed" });
  });

  test("ENOSPC on the final rename → 507 disk_full; EACCES → 422 not_writable; file intact", async () => {
    copyFileSync(fixture("poco"), eco);
    const before = readFileSync(eco);
    const real = fs.realpathSync(eco);
    for (const [code, status, error] of [
      ["ENOSPC", 507, "disk_full"],
      ["EACCES", 422, "not_writable"],
    ] as const) {
      const orig = fs.renameSync;
      const rename = spyOn(fs, "renameSync").mockImplementation((a, b) => {
        if (b === real) throw ioError(code);
        return orig(a, b);
      });
      try {
        expect(await json(await apply(), status)).toMatchObject({ error });
      } finally {
        rename.mockRestore();
      }
      expect(readFileSync(eco).equals(before)).toBe(true);
    }
  });

  test("ecosystem symlinked outside sites.dir or hard-linked → 422 not_fixable ecosystem_linked", async () => {
    const outside = join(h.dir, "elsewhere.config.js");
    copyFileSync(fixture("poco"), outside);
    rmSync(eco);
    symlinkSync(outside, eco);
    expect(await json(await preview(), 422)).toMatchObject({ error: "not_fixable", reason: "ecosystem_linked" });
    const fixes = (await json<Integration>(await call("POST", "/integration/verify"))).fixes;
    expect(fixes?.find((f) => f.key === "ecosystem_block")).toMatchObject({
      available: false,
      reason: "ecosystem_linked",
    });
    rmSync(eco);
    copyFileSync(fixture("poco"), eco);
    linkSync(eco, join(h.dir, "second-name.config.js"));
    expect(await json(await preview(), 422)).toMatchObject({ reason: "ecosystem_linked" });
    rmSync(eco);
    copyFileSync(fixture("poco"), eco);
  });

  test("file edited while the candidate is validated → 409 changed_during_fix, edit kept", async () => {
    // test-only: loading the candidate (never the live file) appends to the live file, like an editor saving.
    const hook = `if (__filename.includes("panel-candidate")) require("fs").appendFileSync(${JSON.stringify(
      fs.realpathSync(eco),
    )}, "// saved in nano\\n");\n`;
    writeFileSync(eco, hook + readFileSync(fixture("poco"), "utf8"));
    expect(await json(await apply(), 409)).toMatchObject({ error: "changed_during_fix" });
    expect(readFileSync(eco, "utf8").endsWith("// saved in nano\n")).toBe(true);
    copyFileSync(fixture("poco"), eco);
  });

  test("boot removes an orphan candidate (it may hold env secrets)", () => {
    writeFileSync(join(sites, ECOSYSTEM_CANDIDATE), "module.exports = { apps: [] }; // env: s3cret\n");
    h.api.decorator.sites.removeFixCandidate();
    expect(existsSync(join(sites, ECOSYSTEM_CANDIDATE))).toBe(false);
    h.api.decorator.sites.removeFixCandidate(); // nothing left: no error
  });

  test("sites_dir_create: only under HOME; one row; makes the folder (700), apps.json and the template ecosystem", async () => {
    const outside = join(h.dir, "outside", "sites");
    setSetting({ db: h.db, secret: SECRET }, "sites.dir", outside, ADMIN_ID);
    const i = await json<Integration>(await call("GET", "/integration"));
    expect(i.fixes?.filter((f) => f.key !== "pm2_auto_exit")).toEqual([
      {
        key: "sites_dir_create",
        checks: ["sites_dir", "apps_json", "ecosystem_file"],
        available: false,
        reason: "sites_dir_outside_home",
      },
    ]);
    const dir = join(home, "new", "sites");
    setSetting({ db: h.db, secret: SECRET }, "sites.dir", dir, ADMIN_ID);
    const p = await json<FixPreview>(await preview("sites_dir_create"));
    const newEcosystem = join(dir, "ecosystem.config.js");
    expect(p).toMatchObject({ files: [], effects: { dir, newEcosystem, appliesOnRestart: true } });
    expect(existsSync(dir)).toBe(false);
    const r = await json<{ outcome: string; integration: Integration }>(await apply("sites_dir_create"));
    expect(r.outcome).toBe("applied");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(dir, "apps.json"), "utf8")).toBe("[]\n");
    expect(statSync(newEcosystem).mode & 0o777).toBe(0o644);
    const text = readFileSync(newEcosystem, "utf8");
    expect(text).toContain(`const SITES = ${JSON.stringify(dir)};`);
    expect(text).toContain(`const PREFIX = ${JSON.stringify(join(home, "usr"))};`);
    expect(r.integration.checks?.filter((c) => c.state === "error").map((c) => c.key)).toEqual([]);
    expect(r.integration.fixes?.map((f) => f.key)).toEqual(["pm2_auto_exit"]);
    expect(lastAudit()).toEqual({ key: "sites_dir_create", outcome: "applied", newEcosystem: true });
    expect((await json<{ outcome: string }>(await apply("sites_dir_create"))).outcome).toBe("unchanged");
  });

  test("sites_dir_create: folder there, ecosystem missing → one fix that writes only the ecosystem", async () => {
    const dir = join(home, "new", "sites");
    setSetting({ db: h.db, secret: SECRET }, "sites.dir", dir, ADMIN_ID);
    rmSync(join(dir, "ecosystem.config.js"));
    const i = await json<Integration>(await call("POST", "/integration/verify"));
    expect(i.fixes?.[0]).toEqual({ key: "sites_dir_create", checks: ["ecosystem_file"], available: true });
    const p = await json<FixPreview>(await preview("sites_dir_create"));
    expect(p.effects).toMatchObject({ dir: null, newEcosystem: join(dir, "ecosystem.config.js") });
    expect((await json<{ outcome: string }>(await apply("sites_dir_create"))).outcome).toBe("applied");
    expect(existsSync(join(dir, "ecosystem.config.js"))).toBe(true);
    setSetting({ db: h.db, secret: SECRET }, "sites.dir", "~/sites", ADMIN_ID);
  });
});
