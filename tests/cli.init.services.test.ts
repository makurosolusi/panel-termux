import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type FakeScenarioName, probePaths } from "@/cli/cli.host";
import { createFakeHost, type FakeHost, type FakeHostOptions } from "@/cli/cli.host.fake";
import { CliExit, createCliOut } from "@/cli/cli.output";
import { bootStep } from "@/cli/init.boot";
import { parseInitArgs, runInit } from "@/cli/init.command";
import { SELF_VERSION } from "@/cli/init.mode";
import { PANEL_RUN_TEMPLATE, panelSvStep } from "@/cli/init.panel-sv";
import { createPm2Step, PM2_RUN_TEMPLATE } from "@/cli/init.pm2";
import { createPostgresStep } from "@/cli/init.postgres";
import { createRunitStep, type InitTiming, svloggerPath } from "@/cli/init.runit";
import { createStartStep } from "@/cli/init.start";
import {
  defineStep,
  INIT_STEP_IDS,
  INIT_STEP_TITLES,
  type InitContext,
  type InitMode,
  type InitStep,
  type ModeDecision,
  type RiskyAction,
} from "@/cli/init.types";
import { ecosystemFromTemplate } from "@/server/sites/ecosystem.template";
import { ENV_VARS } from "@/shared/env.schema";

// test-only: deploy/sv/panel/run as shipped in 0.4.0/0.5.0 (md5 17778486…, POCO), the known old template (E18)
const OLD_PANEL_RUN = `#!/data/data/com.termux/files/usr/bin/sh
# runit (termux-services) run script of the panel. Installed by scripts/install-phone.sh into
# $PREFIX/var/service/panel/run; stdout+stderr go to the svlogger in log/run.
# Bun auto-loads .env from the working directory; PANEL_DATA_DIR defaults to ./data.
exec 2>&1
cd "\${HOME:-/data/data/com.termux/files/home}/panel" || exit 1
exec ./panel
`;
const OLD_PANEL_RUN_SHA256 = "6587514f56e75c5d9282ac16b268b301b7c2f1b01d288862fe6d67b46a1e94ef"; // git show v0.5.0:…
const T: InitTiming = { daemonMs: 60, svMs: 60, healthMs: 60, pollMs: 5 };
const runit = createRunitStep(T);
const postgres = createPostgresStep(T);
const pm2 = createPm2Step(T);
const start = createStartStep(T);
const MINE: Partial<Record<string, InitStep>> = { runit, postgres, pm2, start, "panel-sv": panelSvStep };
MINE.boot = bootStep;

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-svc-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const SV_OK = (tool: string) => (basename(tool) === "sv" ? { code: 0, stdout: "", stderr: "" } : undefined);
/** Fake host; system() called once so its sandbox seeding happens before any snapshot. */
function host(scenario: FakeScenarioName, opts: FakeHostOptions = {}): FakeHost {
  const root = join(tmp, String(n++));
  mkdirSync(root, { recursive: true });
  const h = createFakeHost(scenario, { root, tty: false, answers: [], execAnswers: SV_OK, ...opts });
  h.system();
  return h;
}
// test-only: a hand-written panel run script (no shipped template)
const CUSTOM_RUN = "#!/data/data/com.termux/files/usr/bin/sh\ncd $HOME/panel && exec ./panel\n";
const healthy = (h: FakeHost): FakeHost => ({ ...h, health: async () => ({ version: SELF_VERSION }) });

function ctxOf(h: FakeHost, mode: InitMode, confirm = true): InitContext & { lines: string[]; risky: RiskyAction[] } {
  const lines: string[] = [];
  const risky: RiskyAction[] = [];
  const out = createCliOut({ stdout: (t) => lines.push(t), stderr: (t) => lines.push(t) });
  return {
    host: h,
    args: parseInitArgs({ yes: true }),
    mode,
    decision: { mode } as ModeDecision,
    out,
    tty: false,
    prompt: h.tty,
    state: { changed: [], manual: [] },
    confirmRisky: async (a) => risky.push(a) > 0 && confirm,
    guardSigint: (fn) => fn(),
    resumeCommand: () => "panel init",
    lines,
    risky,
  };
}
async function planOf(step: InitStep, ctx: InitContext) {
  const s = await step.detect(ctx);
  return { s, lines: step.plan(ctx, s) };
}
const actions = (lines: { kind: string }[]) => lines.filter((l) => l.kind === "action");
async function run(step: InitStep, ctx: InitContext) {
  const { s, lines } = await planOf(step, ctx);
  expect(actions(lines).length).toBeGreaterThan(0);
  await step.apply(ctx, s);
}
const argvs = (h: FakeHost) => h.records.map((r) => r.argv.join(" "));

/** Every path under `dir` with size, mode and mtime (any write shows up); `filesOnly` leaves folders out. */
function snapshot(dir: string, filesOnly = false): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const f = join(d, name);
      const s = lstatSync(f);
      if (!(filesOnly && s.isDirectory())) out.push(`${f} ${s.size} ${s.mode} ${s.mtimeMs}`);
      if (s.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out;
}

describe("detect and plan never write", () => {
  for (const scenario of ["fresh", "poco", "upgrade", "fresh-pg", "nosv"] as const)
    test(scenario, async () => {
      const h = host(scenario);
      const before = snapshot(h.paths.home);
      for (const mode of ["fresh", "repair", "upgrade"] as const)
        for (const step of Object.values(MINE)) await planOf(step as InitStep, ctxOf(h, mode));
      expect(snapshot(h.paths.home)).toEqual(before);
      expect(h.records.filter((r) => r.kind === "run")).toEqual([]);
      expect(argvs(h).filter((a) => /^sv /.test(a))).toEqual([]);
    });
});

describe("runit (step 3)", () => {
  const withDaemon = (h: FakeHost, rc = 0): FakeHost => {
    let up = false;
    return {
      ...h,
      run: async (tool, args, opts) => {
        await h.run(tool, args, opts);
        if (basename(tool) === "service-daemon") {
          mkdirSync(join(h.paths.prefix, "var", "run"), { recursive: true });
          writeFileSync(probePaths(h.paths).daemonPid, "4242\n");
          up = true;
        }
        return rc;
      },
      proc: { ...h.proc, alive: (pid) => (pid === 4242 ? up : h.proc.alive(pid)) },
    };
  };

  test("starts service-daemon with SVDIR+LOGDIR and without ENV_VARS keys (K11b, m4)", async () => {
    const h = host("fresh");
    process.env.GOOGLE_CLIENT_SECRET = "sentinel-secret"; // test-only: must not reach the child env
    try {
      await run(runit, ctxOf(withDaemon(h), "fresh"));
    } finally {
      delete process.env.GOOGLE_CLIENT_SECRET;
    }
    const rec = h.records.find((r) => r.argv[0] === "service-daemon");
    expect(rec?.argv).toEqual(["service-daemon", "start"]);
    expect(rec?.vars).toMatchObject({ SVDIR: h.paths.svdir, LOGDIR: h.paths.logdir });
    expect(rec?.envKeys.filter((k) => ENV_VARS.some((v) => v.name === k))).toEqual([]);
  });

  test("exit 1 with runsvdir alive = ok (m5); alive → nothing to do", async () => {
    expect((await planOf(runit, ctxOf(host("ready"), "repair"))).lines).toEqual([]);
    const ctx = ctxOf(withDaemon(host("fresh"), 1), "fresh");
    await run(runit, ctx);
    expect(ctx.lines.join("")).toContain("runit berjalan");
  });

  test("runsvdir never comes up → exit 3 with reopen-Termux hint", async () => {
    const err = await run(runit, ctxOf({ ...host("fresh"), run: async () => 0 }, "fresh")).catch((e) => e);
    expect(err).toBeInstanceOf(CliExit);
    expect(err.code).toBe(3);
    expect(err.hint).toBe("tutup dan buka lagi Termux, lalu jalankan: panel init");
  });
});

describe("postgres (step 4)", () => {
  test("no data → initdb with the PLAN flags, down removed, sv up postgres", async () => {
    const h = host("fresh");
    const svc = join(h.paths.svdir, "postgres");
    mkdirSync(svc, { recursive: true });
    writeFileSync(join(svc, "down"), "");
    const ctx = ctxOf(h, "fresh");
    await run(postgres, ctx);
    const dir = join(h.paths.prefix, "var", "lib", "postgresql");
    expect(argvs(h)).toContain(`initdb -D ${dir} -U postgres --auth-local=trust --auth-host=scram-sha-256`);
    expect(argvs(h)).toContain("sv up postgres");
    expect(existsSync(join(svc, "down"))).toBe(false);
    expect(ctx.state.changed).toEqual([dir, join(svc, "down")]);
  });

  test("data present and running → nothing; data present and stopped → warning only", async () => {
    expect((await planOf(postgres, ctxOf(host("poco"), "repair"))).lines).toEqual([]);
    const { lines } = await planOf(postgres, ctxOf(host("fresh-pg"), "repair"));
    expect(lines.map((l) => l.kind)).toEqual(["warning"]);
    const h = host("fresh"); // a non-empty data folder without PG_VERSION is never touched
    const dir = join(h.paths.prefix, "var", "lib", "postgresql");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "something"), "x");
    expect((await planOf(postgres, ctxOf(h, "fresh"))).lines.map((l) => l.kind)).toEqual(["error"]);
  });

  test("initdb failing → exit 1, no sv", async () => {
    const h = host("fresh");
    const err = await run(postgres, ctxOf({ ...h, run: async () => 1 }, "fresh")).catch((e) => e);
    expect(err.code).toBe(1);
    expect(argvs(h).some((a) => a.startsWith("sv "))).toBe(false);
  });
});

describe("panel-sv (step 6, E18)", () => {
  const runPath = (h: FakeHost) => join(h.paths.svdir, "panel", "run");

  test("missing → folder from the embedded template, log/run → svlogger, down until step 10", async () => {
    const h = host("fresh");
    await run(panelSvStep, ctxOf(h, "fresh"));
    const dir = join(h.paths.svdir, "panel");
    expect(readFileSync(runPath(h), "utf8")).toBe(PANEL_RUN_TEMPLATE);
    expect(statSync(runPath(h)).mode & 0o777).toBe(0o755);
    expect(readlinkSync(join(dir, "log", "run"))).toBe(svloggerPath(h));
    expect(existsSync(join(dir, "down"))).toBe(true);
    expect(readdirSync(h.paths.svdir)).toEqual(["panel"]); // no .panel.new left
  });

  for (const mode of ["repair", "upgrade"] as const)
    test(`${mode}: known old template → replaced, old one kept as run.bak-0.5.0`, async () => {
      expect(new Bun.CryptoHasher("sha256").update(OLD_PANEL_RUN).digest("hex")).toBe(OLD_PANEL_RUN_SHA256);
      const h = host("poco");
      writeFileSync(runPath(h), OLD_PANEL_RUN);
      const ctx = ctxOf(h, mode);
      await run(panelSvStep, ctx);
      expect(readFileSync(runPath(h), "utf8")).toBe(PANEL_RUN_TEMPLATE);
      expect(readFileSync(`${runPath(h)}.bak-0.5.0`, "utf8")).toBe(OLD_PANEL_RUN);
      expect(ctx.state.changed).toEqual([runPath(h), `${runPath(h)}.bak-0.5.0`]);
    });

  test("custom run script → warning, nothing planned; current → nothing", async () => {
    const h = host("poco");
    writeFileSync(runPath(h), CUSTOM_RUN);
    expect((await planOf(panelSvStep, ctxOf(h, "upgrade"))).lines.map((l) => l.kind)).toEqual(["warning"]);
    writeFileSync(runPath(h), PANEL_RUN_TEMPLATE);
    expect((await planOf(panelSvStep, ctxOf(h, "repair"))).lines).toEqual([]);
    // upgrade with no panel service → reported, not installed (C23)
    const { lines } = await planOf(panelSvStep, ctxOf(host("fresh"), "upgrade"));
    expect(lines.map((l) => l.kind)).toEqual(["warning"]);
  });
});

describe("pm2 (step 7)", () => {
  test("nothing there → ecosystem template, apps.json [], run script with --no-auto-exit + PM2_HOME, sv up", async () => {
    const h = host("fresh");
    const ctx = ctxOf(h, "fresh");
    await run(pm2, ctx);
    const sites = join(h.paths.home, "sites");
    expect(readFileSync(join(sites, "ecosystem.config.js"), "utf8")).toBe(ecosystemFromTemplate(sites, h.paths.prefix));
    expect(readFileSync(join(sites, "apps.json"), "utf8")).toBe("[]\n");
    const runText = readFileSync(join(h.paths.svdir, "pm2", "run"), "utf8");
    expect(runText).toBe(PM2_RUN_TEMPLATE);
    expect(runText).toContain("--no-auto-exit");
    expect(runText).toContain("PM2_HOME");
    expect(argvs(h)).toEqual(["sv up pm2"]); // never restart, never the pm2 CLI (C3, B14)
  });

  test("resume: parts written by an earlier run are kept, the missing ones added", async () => {
    const h = host("fresh");
    const sites = join(h.paths.home, "sites");
    mkdirSync(sites, { recursive: true });
    writeFileSync(join(sites, "ecosystem.config.js"), ecosystemFromTemplate(sites, h.paths.prefix));
    const runtime = probePaths(h.paths).pm2Runtime; // installed by step 2 of the earlier run (M2: needed for the service)
    mkdirSync(join(runtime, ".."), { recursive: true });
    writeFileSync(runtime, "");
    const ctx = ctxOf(h, "repair");
    await run(pm2, ctx);
    expect(ctx.state.changed).toEqual([join(sites, "apps.json"), join(h.paths.svdir, "pm2")]);
  });

  test("hand-made setup (poco) → no action, the Persiapan planners' findings reported", async () => {
    const { lines } = await planOf(pm2, ctxOf(host("poco"), "repair"));
    expect(actions(lines)).toEqual([]);
    expect(lines.map((l) => l.text)).toEqual([
      "ecosystem.config.js belum memuat situs buatan panel (apps.json)",
      "Layanan pm2 bisa berhenti sendiri saat tidak ada situs berjalan",
    ]);
    const h = host("fresh"); // own ecosystem without a pm2 service → reported, nothing written
    mkdirSync(join(h.paths.home, "sites"), { recursive: true });
    writeFileSync(join(h.paths.home, "sites", "ecosystem.config.js"), "module.exports = { apps: [] };\n");
    const own = (await planOf(pm2, ctxOf(h, "repair"))).lines;
    expect(actions(own)).toEqual([]);
    expect(own.map((l) => l.text)).toContain("Layanan pm2 belum dipasang di runit");
  });
});

describe("start (step 10, K9, K21, C22)", () => {
  test("not running → down removed, sv up panel, health = this version", async () => {
    const h = host("fresh-resume"); // panel service with `down`
    const ctx = ctxOf(healthy(h), "fresh");
    await run(start, ctx);
    expect(existsSync(join(h.paths.svdir, "panel", "down"))).toBe(false);
    expect(argvs(h)).toEqual(["sv up panel"]);
    expect(ctx.risky).toEqual([]);
  });

  test("upgrade + running → one confirmed `sv -w 130 restart panel`", async () => {
    const h = host("poco");
    const ctx = ctxOf(healthy(h), "upgrade");
    await run(start, ctx);
    expect(ctx.risky).toEqual(["restart-panel"]);
    expect(argvs(h)).toEqual(["sv -w 130 restart panel"]);
    const no = host("poco"); // restart declined → no restart, manual line
    const declined = ctxOf(healthy(no), "upgrade", false);
    await run(start, declined);
    expect(argvs(no)).toEqual([]);
    expect(declined.state.manual[0]).toContain("sv -w 130 restart panel");
  });

  test("repair + running healthy → nothing; running unhealthy → warning, never a restart", async () => {
    expect((await planOf(start, ctxOf(healthy(host("poco")), "repair"))).lines).toEqual([]);
    const { lines } = await planOf(start, ctxOf({ ...host("poco"), health: async () => null }, "repair"));
    expect(lines.map((l) => l.kind)).toEqual(["warning"]);
  });

  test("not healthy in time → exit 1 with the rollback hint when panel.prev exists", async () => {
    const h = host("fresh-resume");
    writeFileSync(probePaths(h.paths).prev, "old");
    const err = await run(start, ctxOf({ ...h, health: async () => null }, "fresh")).catch((e) => e);
    expect(err.code).toBe(1);
    expect(err.message).toContain("belum menjawab");
    expect(err.hint).toContain("panel rollback");
    // healthy but runit still runs another inode → exit 1 (K21)
    const stale = await run(start, ctxOf(healthy(host("upgrade-partial")), "upgrade")).catch((e) => e);
    expect([stale.code, stale.message.includes("file lama")]).toEqual([1, true]);
  });
});

describe("runInit with the service steps (§4.5 acceptance, C23)", () => {
  const noop = (id: (typeof INIT_STEP_IDS)[number]): InitStep =>
    defineStep({ id, title: INIT_STEP_TITLES[id], detect: async () => null, plan: () => [], apply: async () => {} });
  const steps = INIT_STEP_IDS.map((id) => MINE[id] ?? noop(id));
  async function init(h: FakeHost, values: Record<string, unknown>) {
    const sink: string[] = [];
    const out = createCliOut({ stdout: (t) => sink.push(t), stderr: (t) => sink.push(t) });
    const parsed = { values: { "dry-run": false, "skip-verify": false, ...values }, positionals: [] };
    return { code: await runInit(parsed as never, { out, host: async () => h }, { steps }), text: sink.join("") };
  }

  test("poco upgrade --yes without TTY: only the panel run script (+ .bak) changes, one panel restart", async () => {
    const h = host("poco");
    const runPath = join(h.paths.svdir, "panel", "run");
    writeFileSync(runPath, OLD_PANEL_RUN);
    const eco = join(h.paths.home, "sites", "ecosystem.config.js");
    const ecoBytes = readFileSync(eco);
    const pm2Run = readFileSync(join(h.paths.svdir, "pm2", "run"));
    // files only: the folders holding run/run.bak and the released lock ($PREFIX/tmp) get new mtimes
    const others = () => snapshot(h.paths.home, true).filter((l) => !l.startsWith(runPath));
    const before = others();
    const r = await init(healthy(h), { yes: true });
    expect(r.code).toBe(0);
    expect(others()).toEqual(before);
    expect(readFileSync(`${runPath}.bak-0.5.0`, "utf8")).toBe(OLD_PANEL_RUN);
    expect(readFileSync(eco).equals(ecoBytes)).toBe(true); // hand-written ecosystem byte-identical
    expect(readFileSync(join(h.paths.svdir, "pm2", "run")).equals(pm2Run)).toBe(true);
    const calls = argvs(h);
    expect(calls.filter((a) => a.startsWith("sv "))).toEqual(["sv -w 130 restart panel"]);
    expect(calls.some((a) => /initdb|termux-wake-lock|service-daemon|pm2|cloudflared/.test(a))).toBe(false);
    expect(r.text).toContain("Memulai ulang layanan panel");
    expect(r.text).toContain("Memperbarui run script layanan panel");
  });

  test("poco upgrade with a custom panel run script: run script untouched", async () => {
    const h = host("poco");
    const runPath = join(h.paths.svdir, "panel", "run");
    writeFileSync(runPath, CUSTOM_RUN);
    const bytes = readFileSync(runPath);
    expect((await init(healthy(h), { yes: true })).code).toBe(0);
    expect(readFileSync(runPath).equals(bytes)).toBe(true);
    expect(readdirSync(join(h.paths.svdir, "panel")).some((f) => f.startsWith("run.bak"))).toBe(false);
  });
});
