// The marked ecosystem block (PLAN/06 §3.1) evaluated by real node against apps.json states seen in the POCO lab.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BLOCK_VERSION,
  ecosystemBlock,
  legacyCurrent,
  snippetCurrent,
  snippetOutdated,
} from "@/server/sites/ecosystem.patch";

const node = Bun.which("node");
const root = mkdtempSync(join(tmpdir(), "panel-eco-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** A sites dir with one hand-written app + the block at the end, `apps.json` written by `setup`; returns pm2's app names. */
async function namesFor(setup: (dir: string) => void): Promise<{ names: string[]; stderr: string }> {
  const dir = join(root, `s${++seq}`);
  mkdirSync(dir);
  writeFileSync(
    join(dir, "ecosystem.config.js"),
    `module.exports = { apps: [{ name: "hand", script: "/bin/sh" }] };\n\n${ecosystemBlock("/usr")}`,
  );
  setup(dir);
  const p = Bun.spawn(
    [
      node as string,
      "-e",
      "process.stdout.write(JSON.stringify(require(process.argv[1]).apps.map((a) => a.name)))",
      join(dir, "ecosystem.config.js"),
    ],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
  const [out, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  expect(code).toBe(0);
  return { names: JSON.parse(out) as string[], stderr };
}
const site = (dir: string, name: string, files: string[]) => {
  mkdirSync(join(dir, name), { recursive: true });
  for (const f of files) writeFileSync(join(dir, name, f), "x");
  return join(dir, name);
};
const apps = (dir: string, list: unknown) => writeFileSync(join(dir, "apps.json"), JSON.stringify(list));

describe.skipIf(!node)("block under node", () => {
  test.each([
    ["apps.json missing", (_d: string) => {}],
    ["apps.json empty", (d: string) => writeFileSync(join(d, "apps.json"), "")],
    ["apps.json broken", (d: string) => writeFileSync(join(d, "apps.json"), "[{")],
    ["apps.json is a directory", (d: string) => mkdirSync(join(d, "apps.json"))],
    ["apps.json is an object", (d: string) => apps(d, { name: "x", script: "/bin/sh" })],
  ])("%s → only the hand-written app, runtime keeps going", async (_label, setup) => {
    expect((await namesFor(setup)).names).toEqual(["hand"]);
  });

  test("[null, blog] with blog's run present → hand + blog", async () => {
    const r = await namesFor((d) =>
      apps(d, [null, { name: "blog", cwd: site(d, "blog", ["run", "app"]), script: "./run" }]),
    );
    expect(r.names).toEqual(["hand", "blog"]);
  });

  test("native entry whose script is missing is skipped (E1e), others stay", async () => {
    const r = await namesFor((d) =>
      apps(d, [
        { name: "ghost", cwd: site(d, "ghost", []), script: "./app" },
        { name: "blog2", cwd: site(d, "blog2", ["run"]), script: "./run" },
      ]),
    );
    expect(r.names).toEqual(["hand", "blog2"]);
  });

  test("./run entry without run is skipped", async () => {
    const r = await namesFor((d) => apps(d, [{ name: "norun", cwd: site(d, "norun", ["app"]), script: "./run" }]));
    expect(r.names).toEqual(["hand"]);
  });

  test("entry without a non-empty string script is skipped (path.resolve(cwd, '') would be cwd)", async () => {
    const r = await namesFor((d) =>
      apps(d, [
        { name: "noscript", cwd: site(d, "noscript", ["run"]) },
        { name: "empty", cwd: site(d, "empty", ["run"]), script: "" },
        { name: "numeric", cwd: site(d, "numeric", ["run"]), script: 1 },
      ]),
    );
    expect(r.names).toEqual(["hand"]);
  });

  test("grun entry with ./app missing is NOT filtered (script = grun exists; only that app crash-loops, E1f)", async () => {
    const grun = join(root, "grun");
    writeFileSync(grun, "#!/bin/sh\n");
    const r = await namesFor((d) =>
      apps(d, [{ name: "glibc", cwd: site(d, "glibc", []), script: grun, args: "./app", interpreter: "none" }]),
    );
    expect(r.names).toEqual(["hand", "glibc"]);
  });

  test("absolute script paths resolve as themselves (path.resolve), present and missing", async () => {
    const r = await namesFor((d) => {
      const abs = join(site(d, "abs", ["srv"]), "srv");
      apps(d, [
        { name: "abs", cwd: "/nonexistent", script: abs },
        { name: "absmissing", cwd: d, script: join(d, "nope", "srv") },
        { name: "nocwd", script: "abs/srv" },
      ]);
    });
    expect(r.names).toEqual(["hand", "abs", "nocwd"]);
  });
});

describe("block text and snippetCurrent", () => {
  const block = ecosystemBlock("/usr");
  test("block keeps the existsSync filter (E1e/E5) and uses the file's EOL", () => {
    expect(block).toContain(
      'typeof a.script === "string" && a.script !== "" && fs.existsSync(path.resolve(a.cwd || __dirname, a.script))',
    );
    expect(block.split("\n")[0]).toBe(
      `// >>> panel-termux:apps v${BLOCK_VERSION} (managed by Panel Termux; the panel replaces this block as a whole, do not edit it)`,
    );
    expect(block.split("\n").length).toBe(33);
    expect(ecosystemBlock("/usr", "\r\n")).toBe(block.replaceAll("\n", "\r\n"));
  });

  test("current = one marked block of this version, or the unmarked 0.3.0 template block", () => {
    const tpl =
      "const panelApps = list.filter((a) => fs.existsSync(a.script));\nmodule.exports = { apps: [...panelApps] };";
    expect(snippetCurrent(`module.exports = [];\n${block}`)).toBe(true);
    expect(snippetCurrent(tpl)).toBe(true);
    expect(legacyCurrent(tpl)).toBe(true);
    expect(legacyCurrent(`${tpl}\n${block}`)).toBe(false);
    expect(snippetCurrent(block.replace(`v${BLOCK_VERSION} `, "v0 "))).toBe(false);
    expect(snippetCurrent(block.replace(`v${BLOCK_VERSION} `, "v1 "))).toBe(false);
    expect(snippetCurrent(`${block}${block}`)).toBe(false);
    expect(snippetCurrent(block.replace("// <<< panel-termux:apps", ""))).toBe(false);
    expect(snippetCurrent('module.exports = { apps: [...require("./apps.json")] };')).toBe(false);
    expect(snippetCurrent(null)).toBe(false);
  });

  test("outdated = one marked block of an older version from v1 on (v0 and old spreads are not)", () => {
    expect(snippetOutdated(block.replace(`v${BLOCK_VERSION} `, "v1 "))).toBe(true);
    expect(snippetOutdated(block)).toBe(false);
    expect(snippetOutdated(block.replace(`v${BLOCK_VERSION} `, "v0 "))).toBe(false);
    expect(snippetOutdated(block.replace(`v${BLOCK_VERSION} `, "v1 ").replace("// <<< panel-termux:apps", ""))).toBe(
      false,
    );
    expect(snippetOutdated('module.exports = { apps: [...require("./apps.json")] };')).toBe(false);
    expect(snippetOutdated(null)).toBe(false);
  });
});
