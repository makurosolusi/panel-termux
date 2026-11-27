// The ecosystem probe with the apps.json sentinel, block marker and per-app digests (PLAN/06 §3.8), under host node.
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ECOSYSTEM_CANDIDATE, ecosystemBlock } from "@/server/sites/ecosystem.patch";
import { type EcosystemProbe, PROBE_SENTINEL, probeEcosystem } from "@/server/sites/ecosystem.probe";
import type { SystemAdapters } from "@/server/system/system.types";

const node = Bun.which("node");
const FIXTURES = join(import.meta.dir, "fixtures", "ecosystem");
const root = mkdtempSync(join(tmpdir(), "panel-eco-probe-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** A sites dir holding `text` as ecosystem.config.js; apps.json `[]` unless `appsJson` is null. */
async function probeText(text: string | Buffer, appsJson: string | null = "[]\n"): Promise<EcosystemProbe> {
  const dir = join(root, `s${++seq}`);
  mkdirSync(dir);
  if (appsJson !== null) writeFileSync(join(dir, "apps.json"), appsJson);
  const eco = join(dir, "ecosystem.config.js");
  writeFileSync(eco, text);
  return probeEcosystem({ mode: "fake", home: dir } as unknown as SystemAdapters, eco, dir);
}
const ok = (p: EcosystemProbe) => {
  if (!p.ok) throw new Error(`probe failed: ${p.reason} ${p.detail}`);
  return p;
};
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.config.js`));
const block = ecosystemBlock("/usr");

describe.skipIf(!node)("probe under node", () => {
  test("sentinel is the only apps.json entry seen and is removed from names, envKeys and digests", async () => {
    const real = JSON.stringify([{ name: "blog", script: process.execPath }]);
    const p = ok(await probeText(fixture("old-spread"), real));
    expect(p.names).toEqual(["hand"]);
    expect(p.spreads).toBe(true);
    expect(p.loadedAppsJson).toBe(true);
    expect(Object.keys(p.envKeys)).toEqual(["hand"]);
    expect(Object.keys(p.digests)).toEqual(["hand"]);
    expect(JSON.stringify(p)).not.toContain(PROBE_SENTINEL);
  });

  test("spreads with apps.json [] via the old spread and via the block", async () => {
    expect(ok(await probeText(fixture("old-spread"))).spreads).toBe(true);
    const withBlock = ok(await probeText(`${fixture("poco").toString()}\n${block}`));
    expect(withBlock.spreads).toBe(true);
    expect(withBlock.block).toEqual({ v: 1, listed: true });
    // apps.json missing: resolution fails as under pm2; the block survives it, the old spread does not
    expect((await probeText(fixture("old-spread"), null)).ok).toBe(false);
    const noFile = ok(await probeText(`${fixture("poco").toString()}\n${block}`, null));
    expect(noFile.spreads).toBe(false);
    expect(noFile.names).toEqual(["makuro-solusi", "adminneo"]);
  });

  test("panelApps defined but not spread into apps → spreads false", async () => {
    const tpl = fixture("template").toString().replace("    ...panelApps,\n", "");
    const p = ok(await probeText(tpl));
    expect(p.loadedAppsJson).toBe(true);
    expect(p.spreads).toBe(false);
    expect(p.names).toEqual(["pm2-guard"]);
  });

  test("POCO + block: hand apps' digests unchanged, block listed, no pm2-guard", async () => {
    const before = ok(await probeText(fixture("poco")));
    expect(before.block).toBeNull();
    expect(before.spreads).toBe(false);
    const after = ok(await probeText(Buffer.concat([fixture("poco"), Buffer.from(`\n${block}`)])));
    expect(after.names).toEqual(["makuro-solusi", "adminneo"]);
    expect(after.digests).toEqual(before.digests);
    expect(after.envKeys.adminneo).toEqual(["ADMIN_PASS"]);
    expect(JSON.stringify(after)).not.toContain("test-only-secret-value");
  });

  test("no hand apps: the block adds pm2-guard", async () => {
    const p = ok(await probeText(`module.exports = { apps: [] };\n\n${block}`));
    expect(p.names).toEqual(["pm2-guard"]);
    expect(p.spreads).toBe(true);
  });

  test("frozen list + block: file still loads, block marker absent; function export: listed false", async () => {
    const frozen = ok(await probeText(`${fixture("frozen-apps").toString()}\n${block}`));
    expect(frozen.names).toEqual(["hand"]);
    expect(frozen.block).toBeNull();
    const fn = ok(await probeText(`${fixture("exports-function").toString()}\n${block}`));
    expect(fn.block).toEqual({ v: 1, listed: false });
  });

  test("digest is stable against key order and changes with values", async () => {
    const a = ok(await probeText('module.exports = { apps: [{ name: "x", script: "/a", env: { A: "1", B: "2" } }] };'));
    const b = ok(await probeText('module.exports = { apps: [{ env: { B: "2", A: "1" }, script: "/a", name: "x" }] };'));
    const c = ok(await probeText('module.exports = { apps: [{ name: "x", script: "/a", env: { A: "1", B: "3" } }] };'));
    expect(a.digests.x).toMatch(/^[0-9a-f]{64}$/);
    expect(b.digests.x).toBe(a.digests.x as string);
    expect(c.digests.x).not.toBe(a.digests.x as string);
  });

  test("candidate name is a *.config.js the probe accepts", async () => {
    const dir = join(root, "cand");
    mkdirSync(dir);
    copyFileSync(join(FIXTURES, "array-export.config.js"), join(dir, ECOSYSTEM_CANDIDATE));
    const p = ok(
      await probeEcosystem(
        { mode: "fake", home: dir } as unknown as SystemAdapters,
        join(dir, ECOSYSTEM_CANDIDATE),
        dir,
      ),
    );
    expect(p.names).toEqual(["hand"]);
  });
});
