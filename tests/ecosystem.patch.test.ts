// planEcosystemFix on hand-written fixtures (PLAN/06 §3.3), each loaded by the real probe under host node.
import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ECOSYSTEM_MAX_BYTES,
  type EcosystemFixPlan,
  ecosystemBlock,
  planEcosystemFix,
} from "@/server/sites/ecosystem.patch";
import { type EcosystemProbe, probeEcosystem } from "@/server/sites/ecosystem.probe";
import type { SystemAdapters } from "@/server/system/system.types";

const node = Bun.which("node");
const FIXTURES = join(import.meta.dir, "fixtures", "ecosystem");
const PREFIX = "/data/data/com.termux/files/usr"; // test-only: the phone's prefix, as in marked-current
const root = mkdtempSync(join(tmpdir(), "panel-eco-patch-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** Copies a fixture into its own sites dir as ecosystem.config.js (with apps.json `[]`) and returns its path. */
function sitesWith(fixture: string): { dir: string; eco: string } {
  const dir = join(root, `s${++seq}`);
  mkdirSync(dir);
  writeFileSync(join(dir, "apps.json"), "[]\n");
  const eco = join(dir, "ecosystem.config.js");
  copyFileSync(join(FIXTURES, `${fixture}.config.js`), eco);
  return { dir, eco };
}
const fakeSystem = (home: string) => ({ mode: "fake", home }) as unknown as SystemAdapters;
const probe = (dir: string, path: string) => probeEcosystem(fakeSystem(dir), path, dir);

async function plan(fixture: string): Promise<{ p: EcosystemFixPlan; bytes: Buffer; dir: string; eco: string }> {
  const { dir, eco } = sitesWith(fixture);
  const bytes = readFileSync(eco);
  const before = await probe(dir, eco);
  const p = planEcosystemFix({
    bytes,
    path: eco,
    realDir: dir,
    sitesDirReal: dir,
    nlink: 1,
    probeBefore: before,
    prefix: PREFIX,
  });
  return { p, bytes, dir, eco };
}
const patched = (p: EcosystemFixPlan) => {
  if (p.kind !== "patch") throw new Error(`expected patch, got ${JSON.stringify(p)}`);
  return p;
};

describe.skipIf(!node)("fixtures under node", () => {
  test.each([
    ["template", "unchanged", null],
    ["marked-current", "unchanged", null],
    ["old-spread-x2", "manual", "unknown_apps_json_use"],
    ["dynamic-require", "manual", "unknown_apps_json_use"],
    ["markers-broken", "manual", "markers_broken"],
    ["latin1", "manual", "not_utf8"],
    ["array-export", "patch", null],
    ["exports-function", "patch", null],
    ["frozen-apps", "patch", null],
  ])("%s → %s %s", async (fixture, kind, reason) => {
    const { p } = await plan(fixture);
    expect(p.kind).toBe(kind as EcosystemFixPlan["kind"]);
    if (p.kind === "manual") expect(p.reason as string).toBe(reason as string);
  });

  test("POCO: candidate = original bytes + blank line + block; hand apps kept, no guard", async () => {
    const { p, bytes } = await plan("poco");
    const r = patched(p);
    expect(r.candidate.equals(Buffer.concat([bytes, Buffer.from(`\n${ecosystemBlock(PREFIX)}`)]))).toBe(true);
    expect(r.effects).toEqual({
      keepApps: ["makuro-solusi", "adminneo"],
      addApps: [],
      guard: false,
      oldSpread: false,
      appliesOnRestart: false,
      dir: null,
    });
    expect(r.changes).toEqual([
      { kind: "add", afterLine: 10, lines: ["", ...ecosystemBlock(PREFIX).trimEnd().split("\n")] },
    ]);
  });

  test("running the fix again on its own result is unchanged", async () => {
    const { p, dir, eco } = await plan("poco");
    writeFileSync(eco, patched(p).candidate);
    const again = planEcosystemFix({
      bytes: readFileSync(eco),
      path: eco,
      realDir: dir,
      sitesDirReal: dir,
      nlink: 1,
      probeBefore: await probe(dir, eco),
      prefix: PREFIX,
    });
    expect(again).toEqual({ kind: "unchanged" });
  });

  test("old spread: that line removed, block appended, rest byte-identical", async () => {
    const { p, bytes } = await plan("old-spread");
    const r = patched(p);
    const text = bytes.toString("utf8");
    const line = '    ...require("./apps.json"),\n';
    expect(r.candidate.toString("utf8")).toBe(`${text.replace(line, "")}\n${ecosystemBlock(PREFIX)}`);
    expect(r.effects.oldSpread).toBe(true);
    expect(r.changes[0]).toEqual({ kind: "remove", line: 5, text: line.trimEnd() });
    expect(r.changes[1]).toMatchObject({ kind: "add", afterLine: 7 });
  });

  test("old spread inline: the expression goes, the line stays", () => {
    const text = 'module.exports = { apps: [{ name: "h", script: "/bin/sh" }, ...require("./apps")] };\n';
    const r = patched(
      planEcosystemFix({
        bytes: Buffer.from(text),
        path: "/s/ecosystem.config.js",
        realDir: "/s",
        sitesDirReal: "/s",
        nlink: 1,
        probeBefore: okProbe({ loadedAppsJson: true, names: ["h"] }),
        prefix: PREFIX,
      }),
    );
    expect(r.candidate.toString("utf8").split("\n")[0]).toBe(
      'module.exports = { apps: [{ name: "h", script: "/bin/sh" }, ] };',
    );
    expect(r.changes.slice(0, 2)).toEqual([
      { kind: "remove", line: 1, text: text.trimEnd() },
      { kind: "add", afterLine: 1, lines: ['module.exports = { apps: [{ name: "h", script: "/bin/sh" }, ] };'] },
    ]);
  });

  test("older marked block replaced whole; text before and after the markers kept", async () => {
    const { p, bytes } = await plan("marked-v0");
    const r = patched(p);
    const text = bytes.toString("utf8");
    const from = text.indexOf("// >>>");
    const to = text.indexOf("// <<< panel-termux:apps\n") + "// <<< panel-termux:apps\n".length;
    expect(r.candidate.toString("utf8")).toBe(text.slice(0, from) + ecosystemBlock(PREFIX) + text.slice(to));
    expect(r.changes.filter((c) => c.kind === "remove").map((c) => (c as { line: number }).line)).toEqual([
      4, 5, 6, 7, 8,
    ]);
    expect(r.changes.at(-1)).toMatchObject({ kind: "add", afterLine: 3 });
  });

  test("v1 block (Indonesian comments) replaced whole by the v2 block; nothing else changes", async () => {
    const { p, bytes } = await plan("marked-v1");
    const r = patched(p);
    const text = bytes.toString("utf8");
    const from = text.indexOf("// >>>");
    expect(text.slice(from)).toStartWith("// >>> panel-termux:apps v1 ");
    expect(r.candidate.toString("utf8")).toBe(text.slice(0, from) + ecosystemBlock(PREFIX));
    expect(r.effects).toMatchObject({ keepApps: ["hand"], oldSpread: false });
    // Only the comment lines and the version marker differ between v1 and v2.
    const oldLines = text.slice(from).split("\n");
    const diff = ecosystemBlock(PREFIX)
      .split("\n")
      .map((l, i) => (l === oldLines[i] ? null : i))
      .filter((i) => i !== null);
    expect(diff).toEqual([0, 1, 2, 3, 26]);
  });

  test("BOM kept as the first bytes; CRLF file gets a CRLF block", async () => {
    const bom = patched((await plan("bom")).p);
    expect([...bom.candidate.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const { p, bytes } = await plan("crlf");
    const crlf = patched(p);
    expect(crlf.candidate.equals(Buffer.concat([bytes, Buffer.from(`\r\n${ecosystemBlock(PREFIX, "\r\n")}`)]))).toBe(
      true,
    );
    expect(crlf.candidate.toString("utf8").replaceAll("\r\n", "")).not.toContain("\n");
  });

  test("no hand-written apps → effects.guard", async () => {
    const { p } = await plan("exports-function");
    expect(patched(p).effects.guard).toBe(true);
  });
});

const okProbe = (o: Partial<Extract<EcosystemProbe, { ok: true }>> = {}): EcosystemProbe => ({
  ok: true,
  loadedAppsJson: false,
  names: [],
  envKeys: {},
  spreads: false,
  block: null,
  digests: {},
  ...o,
});
const base = {
  bytes: Buffer.from("module.exports = { apps: [] };\n"),
  path: "/s/ecosystem.config.js",
  realDir: "/s",
  sitesDirReal: "/s",
  nlink: 1,
  probeBefore: okProbe(),
  prefix: PREFIX,
};

describe("refusals before any text logic", () => {
  test.each([
    ["not *.config.js", { path: "/s/ecosystem.js" }, "not_config_js"],
    ["missing", { bytes: null }, "ecosystem_missing"],
    ["symlink out of sites.dir", { realDir: "/elsewhere" }, "ecosystem_linked"],
    ["hardlink", { nlink: 2 }, "ecosystem_linked"],
    ["too large", { bytes: Buffer.alloc(ECOSYSTEM_MAX_BYTES + 1, 0x20) }, "too_large"],
    [
      "unloadable",
      { probeBefore: { ok: false, reason: "syntax", detail: "x" } as EcosystemProbe },
      "ecosystem_unloadable",
    ],
    [
      "end marker before start",
      { bytes: Buffer.from("// <<< panel-termux:apps\n// >>> panel-termux:apps v1\n") },
      "markers_broken",
    ],
    ["two block pairs", { bytes: Buffer.from(`${ecosystemBlock(PREFIX)}${ecosystemBlock(PREFIX)}`) }, "markers_broken"],
  ])("%s", (_l, over, reason) => {
    expect(planEcosystemFix({ ...base, ...over } as typeof base)).toEqual({ kind: "manual", reason: reason as never });
  });

  test("current block with another prefix is replaced", () => {
    const text = `module.exports = [];\n\n${ecosystemBlock("/old")}`;
    expect(planEcosystemFix({ ...base, bytes: Buffer.from(text) }).kind).toBe("patch");
  });

  test("file without trailing newline gets one, then a blank line", () => {
    const r = patched(planEcosystemFix({ ...base, bytes: Buffer.from("module.exports = []") }));
    expect(r.candidate.toString("utf8")).toBe(`module.exports = []\n\n${ecosystemBlock(PREFIX)}`);
  });
});

describe("ecosystemBlock", () => {
  test("guard script inserted via JSON.stringify, not raw", () => {
    const b = ecosystemBlock('/p/we"ird');
    expect(b).toContain('script: "/p/we\\"ird/bin/sleep"');
    expect(b.startsWith("// >>> panel-termux:apps v2 (managed by Panel Termux;")).toBe(true);
    expect(b.endsWith("// <<< panel-termux:apps\n")).toBe(true);
  });
});
