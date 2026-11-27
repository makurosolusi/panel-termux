import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type FakeScenarioName, probePaths } from "@/cli/cli.host";
import { createFakeHost, type FakeAnswer, type FakeHost } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { runInit } from "@/cli/init.command";
import { packagesStep, parseAptSimulation } from "@/cli/init.packages";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-init-pkg-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

// test-only: apt-get -s output captured on POCO in lab L8 (PLAN/debate/07-cli-lab-results.md)
const L8_UPGRADE = "Inst runit [2.3.1] (2.3.1-1 termux-main stable:stable [aarch64])\n";
const L8_NEW = `termux-services is already the newest version (0.13-1).
The following NEW packages will be installed:
  jq
0 upgraded, 1 newly installed, 0 to remove and 1 not upgraded.
Inst jq (1.8.2 termux-main stable:stable [aarch64])
Conf jq (1.8.2 termux-main stable:stable [aarch64])
`;
const L8_REINSTALL = `0 upgraded, 0 newly installed, 1 reinstalled, 0 to remove and 1 not upgraded.
Inst cloudflared [2026.11.2] (2026.11.2 termux-main stable:stable [aarch64])
`;
const L8_NEWEST = `termux-api is already the newest version (0.60.0).
0 upgraded, 0 newly installed, 0 to remove and 1 not upgraded.
`;

/**
 * Fake phone whose `run` has effects: `pkg install X` installs X (nodejs-lts also drops node), `npm` drops
 * pm2-runtime, `apt-mark hold` holds, `dpkg --configure` cleans the audit. `sim` = apt-get -s stdout.
 */
function phone(scenario: FakeScenarioName, o: { tty?: boolean; answers?: FakeAnswer[]; sim?: string } = {}) {
  const added = new Set<string>();
  const held = new Set<string>();
  let auditClean = false;
  const h: FakeHost = createFakeHost(scenario, {
    root: join(tmp, String(n++)),
    tty: o.tty ?? false,
    answers: o.answers ?? [],
    execAnswers: (tool, args) => {
      const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
      if (tool === "dpkg" && args[0] === "-s" && added.has(args[1] ?? ""))
        return ok(`Package: ${args[1]}\nStatus: install ok installed\n`);
      if (tool === "dpkg" && args[0] === "--audit" && auditClean) return ok("");
      if (tool === "apt-mark" && held.size > 0) return ok([...held].map((p) => `${p}\n`).join(""));
      if (tool === "apt-get" && o.sim !== undefined) return ok(o.sim);
      return undefined;
    },
  });
  const p = probePaths(h.paths);
  const touch = (f: string) => {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, "");
  };
  const run = h.run;
  h.run = async (tool, args = [], opts) => {
    if (tool === "pkg" && args[0] === "install") for (const a of args.slice(1)) if (!a.startsWith("-")) added.add(a);
    if (added.has("nodejs-lts")) touch(p.node);
    if (tool === "npm") touch(p.pm2Runtime);
    if (tool === "apt-mark") for (const a of args.slice(1)) held.add(a);
    if (tool === "dpkg") auditClean = true;
    return run(tool, args, opts);
  };
  return h;
}

async function init(h: FakeHost, flags: Record<string, string | boolean | string[]> = {}) {
  const lines: string[] = [];
  const out = createCliOut({ stdout: (t) => lines.push(t), stderr: (t) => lines.push(t) });
  let code: number;
  try {
    code = await runInit(
      { values: { yes: false, "dry-run": false, "skip-verify": false, lang: "en", ...flags }, positionals: [] },
      { out, host: async () => h },
      { steps: [packagesStep] },
    );
  } catch (e) {
    const err = e as { code?: number; message: string; hint?: string };
    if (typeof err.code !== "number") throw e;
    out.fail(err.message, err.hint);
    code = err.code;
  }
  return { code, text: lines.join("") };
}

const runs = (h: FakeHost) => h.records.filter((r) => r.kind === "run").map((r) => r.argv.join(" "));
const PKG_TOOLS = new Set(["pkg", "apt", "apt-get", "apt-mark", "dpkg"]);

function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const f = join(d, name);
      const s = statSync(f);
      out.push(`${f} ${s.size} ${s.mode} ${s.mtimeMs}`);
      if (s.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out;
}

describe("parseAptSimulation (lab L8)", () => {
  test("installed package with [version] = replaced; without = new; no Inst line = nothing", () => {
    expect(parseAptSimulation(L8_UPGRADE)).toEqual({ added: [], replaced: ["runit"] });
    expect(parseAptSimulation(L8_NEW)).toEqual({ added: ["jq"], replaced: [] });
    expect(parseAptSimulation(L8_REINSTALL)).toEqual({ added: [], replaced: ["cloudflared"] });
    expect(parseAptSimulation(L8_NEWEST)).toEqual({ added: [], replaced: [] });
  });
});

describe("packages step (K7, K8, D9, C20)", () => {
  test("fresh: plan = pkg upgrade + install, --dry-run writes nothing and runs nothing", async () => {
    const h = phone("fresh");
    const before = snapshot(h.paths.home);
    const r = await init(h, { "dry-run": true });
    expect(r.code).toBe(0);
    expect(r.text).toContain(
      "Memperbarui paket Termux (pkg upgrade), lalu memasang: termux-services, nodejs-lts, postgresql, cloudflared, termux-api",
    );
    expect(r.text).toContain("Menahan cloudflared dan postgresql dari upgrade otomatis");
    expect(r.text).toContain("Memasang pm2 7.1.2 (npm)");
    expect(runs(h)).toEqual([]);
    expect(snapshot(h.paths.home)).toEqual(before);
  });

  test("fresh --yes without TTY: upgrade, install each missing package, pm2, then hold; all with LC_ALL=C", async () => {
    const h = phone("fresh");
    const r = await init(h, { yes: true });
    expect(r.code).toBe(0);
    const opts = "-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold";
    expect(runs(h)).toEqual([
      `pkg upgrade ${opts}`,
      `pkg install ${opts} termux-services`,
      `pkg install ${opts} nodejs-lts`,
      `pkg install ${opts} postgresql`,
      `pkg install ${opts} cloudflared`,
      `pkg install ${opts} termux-api`,
      "npm install -g pm2@7.1.2",
      "apt-mark hold cloudflared postgresql",
    ]);
    for (const rec of h.records.filter((x) => x.kind !== "fetch" && PKG_TOOLS.has(x.argv[0] ?? "")))
      expect(rec.vars?.LC_ALL).toBe("C");
    expect(h.records.find((x) => x.argv[0] === "pkg")?.envKeys).toContain("DEBIAN_FRONTEND");
    expect(h.records.some((x) => x.argv.includes("--reinstall"))).toBe(false);
    expect(h.records.some((x) => x.argv[0] === "apt-get")).toBe(false); // upgrade path: no simulation
    expect(r.text).toContain("Ditahan: cloudflared, postgresql");
  });

  test("fresh with TTY: declining pkg upgrade falls back to the simulated install", async () => {
    const h = phone("fresh", { tty: true, answers: [true, false], sim: L8_NEW });
    expect((await init(h)).code).toBe(0);
    expect(runs(h).some((c) => c.startsWith("pkg upgrade"))).toBe(false);
    expect(h.records.some((x) => x.argv.join(" ").startsWith("apt-get -s install termux-services"))).toBe(true);
  });

  test("--ssh-key adds openssh; --skip postgres/tunnel leaves those out", async () => {
    const h = phone("fresh");
    const r = await init(h, { "dry-run": true, "ssh-key": "/k.pub", skip: ["postgres", "tunnel"] });
    expect(r.text).toContain("memasang: termux-services, nodejs-lts, termux-api, openssh");
    expect(r.text).not.toContain("Menahan");
  });

  test("a failing pkg install names the package and panel docs paket (exit 1)", async () => {
    const h = phone("fresh");
    const run = h.run;
    h.run = async (tool, args = [], opts) => ((await run(tool, args, opts)) || args.includes("postgresql") ? 100 : 0);
    const r = await init(h, { yes: true });
    expect(r.code).toBe(1);
    expect(r.text).toContain("Memasang paket postgresql gagal (pkg keluar dengan kode 100)");
    expect(r.text).toContain("panel docs paket");
  });

  test("fresh-pg (PostgreSQL data → repair): never pkg upgrade; simulated first; postgresql held", async () => {
    const h = phone("fresh-pg", { tty: true, answers: [true, true], sim: L8_UPGRADE });
    const r = await init(h);
    expect(r.code).toBe(0);
    expect(r.text).toContain("Memasang: termux-services, nodejs-lts, cloudflared, termux-api");
    expect(r.text).toContain("Pemasangan juga memperbarui paket terpasang: runit");
    expect(runs(h).some((c) => c.includes("upgrade"))).toBe(false);
    const sim = h.records.find((x) => x.argv[0] === "apt-get");
    expect(sim?.argv).toEqual([
      "apt-get",
      "-s",
      "install",
      "termux-services",
      "nodejs-lts",
      "cloudflared",
      "termux-api",
    ]);
    expect(sim?.vars?.LC_ALL).toBe("C");
    expect(runs(h)).toContain("apt-mark hold cloudflared postgresql");
    // apply refreshes the lists once, then simulates again on them, then installs package by package
    const seq = h.records.map((x) => `${x.kind} ${x.argv.slice(0, 2).join(" ")}`);
    const update = seq.indexOf("run apt-get update");
    expect(seq.filter((x) => x === "run apt-get update")).toHaveLength(1);
    expect(seq.lastIndexOf("exec apt-get -s")).toBeGreaterThan(update);
    expect(seq.indexOf("run pkg install")).toBeGreaterThan(seq.lastIndexOf("exec apt-get -s"));
    expect(r.text).toContain("Memperbarui daftar paket (apt-get update)");
  });

  test("fresh-pg: simulation replacing cloudflared/postgresql → exit 3, no pkg install", async () => {
    const h = phone("fresh-pg", { tty: true, answers: [true], sim: L8_REINSTALL });
    const r = await init(h);
    expect(r.code).toBe(3);
    expect(r.text).toContain("akan ikut mengganti cloudflared");
    expect(r.text).toContain("pkg install termux-services nodejs-lts cloudflared termux-api");
    expect(runs(h).filter((c) => c.startsWith("pkg"))).toEqual([]);
  });

  test("fresh-pg without TTY: reported only, nothing runs (repair policy)", async () => {
    const h = phone("fresh-pg", { sim: L8_NEW });
    const r = await init(h, { yes: true });
    expect(r.code).toBe(0);
    expect(r.text).toContain("(butuh terminal)");
    expect(runs(h)).toEqual([]);
  });

  test("poco: nothing to do, holds present → step complete, no package command", async () => {
    const h = phone("poco");
    const r = await init(h, { yes: true });
    expect(r.code).toBe(0);
    expect(r.text).toContain("Sudah lengkap: paket Termux.");
    expect(runs(h)).toEqual([]);
    expect(h.records.some((x) => x.argv[0] === "apt-get")).toBe(false);
  });

  test("fresh-resume: dpkg --audit not empty → dpkg --configure -a, then the rest", async () => {
    const h = phone("fresh-resume");
    const r = await init(h, { yes: true });
    expect(r.code).toBe(0);
    expect(r.text).toContain("Menyelesaikan pemasangan paket yang terputus");
    const cmds = runs(h);
    expect(cmds[0]).toBe("dpkg --configure -a --force-confdef --force-confold");
    expect(cmds[1]).toStartWith("pkg upgrade");
    expect(cmds).toContain(
      "pkg install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold postgresql",
    );
    expect(cmds.some((c) => c.includes("termux-services"))).toBe(false); // already installed
  });

  test("repair with a dirty dpkg --audit → exit 3 with the command, nothing runs", async () => {
    const h = phone("fresh-pg", { tty: true, answers: [true], sim: L8_NEW });
    const audit = h.exec;
    h.exec = async (tool, args = [], opts) =>
      tool === "dpkg" && args[0] === "--audit"
        ? { code: 0, stdout: "The following packages are only half configured:\n x\n", stderr: "" }
        : audit(tool, args, opts);
    const r = await init(h);
    expect(r.code).toBe(3);
    expect(r.text).toContain("jalankan: dpkg --configure -a --force-confdef --force-confold");
    expect(runs(h)).toEqual([]);
  });
});
