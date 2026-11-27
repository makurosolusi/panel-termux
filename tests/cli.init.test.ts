import { Database } from "bun:sqlite";
import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeScenarioName, probePaths } from "@/cli/cli.host";
import { createFakeHost, FAKE_NEW_VERSION, FAKE_OLD_VERSION, type FakeHostOptions } from "@/cli/cli.host.fake";
import { runCli } from "@/cli/cli.main";
import { createCliOut } from "@/cli/cli.output";
import { INIT_STEPS, runInit } from "@/cli/init.command";
import { detectMode, releaseTag, SELF_VERSION } from "@/cli/init.mode";
import {
  defineStep,
  INIT_STEP_IDS,
  INIT_STEP_TITLES,
  type InitContext,
  type InitStep,
  type InitStepId,
  type RiskyAction,
} from "@/cli/init.types";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-init-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const fresh = () => {
  const d = join(tmp, String(n++));
  mkdirSync(d, { recursive: true });
  return d;
};
const host = (scenario: FakeScenarioName, opts: FakeHostOptions = {}) =>
  createFakeHost(scenario, { root: fresh(), tty: false, answers: [], ...opts });
type Host = ReturnType<typeof host>;

/** Every path under `dir` with size, mode and mtime: any write shows up. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const f = join(d, name);
      const s = statSync(f, { throwIfNoEntry: false });
      out.push(`${f} ${s?.size} ${s?.mode} ${s?.mtimeMs}`);
      if (s?.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out;
}

type Flags = Record<string, string | boolean | string[] | undefined>;
const FLAGS: Flags = { yes: false, "dry-run": false, "skip-verify": false };

/** runInit with collected output; `steps` default = recording stubs that always plan one action. */
async function init(h: Host, flags: Flags = {}, steps: readonly InitStep[] = stubs().steps) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = createCliOut({ stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) });
  let exit: number;
  try {
    exit = await runInit({ values: { ...FLAGS, ...flags }, positionals: [] }, { out, host: async () => h }, { steps });
  } catch (e) {
    const err = e as { code?: number; message: string; hint?: string };
    if (typeof err.code !== "number") throw e;
    out.fail(err.message, err.hint);
    exit = err.code;
  }
  return { code: exit, stdout: stdout.join(""), stderr: stderr.join("") };
}

/** Stub steps recording detect/apply; `todo` = ids that still have work (default all); `onApply` per id. */
function stubs(
  todo: ReadonlySet<InitStepId> = new Set(INIT_STEP_IDS),
  onApply?: (id: InitStepId, ctx: InitContext) => Promise<void>,
) {
  const applied: InitStepId[] = [];
  const detected: InitStepId[] = [];
  const steps = INIT_STEP_IDS.map((id) =>
    defineStep({
      id,
      title: INIT_STEP_TITLES[id],
      detect: async () => {
        detected.push(id);
        return todo.has(id);
      },
      plan: (_ctx, needed: boolean) => (needed ? [{ kind: "action" as const, text: `aksi ${id}` }] : []),
      apply: async (ctx) => {
        applied.push(id);
        await onApply?.(id, ctx);
      },
    }),
  );
  return { steps, applied, detected };
}

describe("detectMode (K7, K20, K21, C20, E2)", () => {
  const cases: [FakeScenarioName, string][] = [
    ["fresh", "fresh"],
    ["fresh-resume", "fresh"], // binary + panel service do not count as user data
    ["fresh-pg", "repair"], // PostgreSQL data without ~/panel
    ["poco", "upgrade"], // same version, other build
    ["upgrade", "upgrade"],
    ["downgrade", "downgrade"],
  ];
  for (const [scenario, mode] of cases)
    test(`${scenario} → ${mode}`, async () => {
      expect((await detectMode(host(scenario))).mode).toBe(mode as never);
    });

  test("upgrade: installed version from /api/health", async () => {
    expect((await detectMode(host("upgrade"))).installed).toEqual({ version: FAKE_OLD_VERSION, source: "health" });
    expect((await detectMode(host("downgrade"))).installed.version).toBe(FAKE_NEW_VERSION);
  });

  test("same bytes as this binary → repair; same bytes but runit runs another inode → upgrade (K21)", async () => {
    const self = join(fresh(), "panel-self");
    writeFileSync(self, "\x7fELF fake panel\n"); // test-only: same bytes as the fake's installed binary
    const same = await detectMode(host("ready", { selfPath: self }));
    expect(same).toMatchObject({ mode: "repair", sameBinary: true, staleProcess: false });
    const partial = await detectMode(host("upgrade-partial", { selfPath: self }));
    expect(partial).toMatchObject({ mode: "upgrade", sameBinary: true, staleProcess: true });
  });

  test("panel not answering: version from app_meta (read-only), else unknown → upgrade", async () => {
    const h = host("nosv");
    expect((await detectMode(h)).installed).toEqual({ version: null, source: null });
    expect((await detectMode(h)).mode).toBe("upgrade");
    const dataDir = probePaths(h.paths).dataDir;
    const db = new Database(join(dataDir, "panel.db"));
    db.run("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT)");
    db.run("INSERT INTO app_meta VALUES ('panel_version', '99.1.0')");
    db.close();
    const d = await detectMode(h);
    expect(d.installed).toEqual({ version: "99.1.0", source: "db" });
    expect(d.mode).toBe("downgrade");
  });

  test("fresh never counts the lock, the binary or the panel service", async () => {
    const h = host("fresh-resume");
    mkdirSync(join(h.paths.prefix, "tmp"), { recursive: true });
    writeFileSync(join(h.paths.prefix, "tmp", "panel-init.lock"), "1\n");
    expect((await detectMode(h)).userData).toEqual([]);
  });
});

describe("--dry-run writes nothing (§4.1)", () => {
  for (const scenario of ["fresh", "fresh-pg", "fresh-resume", "poco", "upgrade", "upgrade-partial"] as const)
    test(scenario, async () => {
      const h = host(scenario);
      h.system(); // the fake system seeds its sandbox on creation; init itself must add nothing
      const before = snapshot(h.paths.home);
      const r = await init(h, { "dry-run": true }, INIT_STEPS);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("--dry-run: tidak ada yang diubah");
      expect(r.stdout).toContain("belum diimplementasikan");
      expect(snapshot(h.paths.home)).toEqual(before);
      expect(h.records.filter((x) => x.kind === "run")).toEqual([]);
    });

  test("downgrade: exit 3 with the rollback hint, also in --dry-run (K20, C27)", async () => {
    for (const flags of [{ "dry-run": true }, { yes: true }]) {
      const s = stubs();
      const r = await init(host("downgrade"), flags, s.steps);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain("lebih lama");
      expect(r.stderr).toContain("panel rollback [--db]");
      expect(s.detected).toEqual([]);
    }
  });
});

describe("plan and run rules per mode (§4 mode table, C23)", () => {
  test("upgrade --yes without TTY: only binary, panel-sv, start run; the rest is reported (K21)", async () => {
    const s = stubs();
    const r = await init(host("upgrade"), { yes: true }, s.steps);
    expect(r.code).toBe(0);
    expect(s.applied).toEqual(["binary", "panel-sv", "start"]);
    expect(r.stdout).toContain(`Panel v${FAKE_OLD_VERSION} sudah terpasang`);
    expect(r.stdout).toContain("⚠️ aksi packages (tidak dipasang saat upgrade)");
    expect(r.stdout).toContain("→ jalankan lagi panel init di terminal");
  });

  test("repair without TTY (--yes too): packages, postgres, boot only reported; with TTY they run", async () => {
    const self = join(fresh(), "panel-self");
    writeFileSync(self, "\x7fELF fake panel\n"); // test-only
    const quiet = stubs();
    const r = await init(host("ready", { selfPath: self }), { yes: true }, quiet.steps);
    expect(r.code).toBe(0);
    for (const id of ["packages", "postgres", "boot"] as const) expect(quiet.applied).not.toContain(id);
    expect(r.stdout).toContain("(butuh terminal)");
    const loud = stubs();
    await init(host("ready", { selfPath: self, tty: true, answers: [true] }), {}, loud.steps);
    expect(loud.applied).toEqual([
      "binary",
      "packages",
      "runit",
      "postgres",
      "env",
      "panel-sv",
      "pm2",
      "tunnel",
      "boot",
      "start",
    ]);
  });

  test("fresh: every step; ssh only with --ssh-key, --skip leaves steps out entirely", async () => {
    const all = stubs();
    expect((await init(host("fresh"), { yes: true, "ssh-key": "-" }, all.steps)).code).toBe(0);
    expect(all.applied).toEqual([...INIT_STEP_IDS]);
    const some = stubs();
    await init(host("fresh"), { yes: true, skip: ["tunnel", "boot"] }, some.steps);
    expect(some.applied).toEqual(INIT_STEP_IDS.filter((id) => !["ssh", "tunnel", "boot"].includes(id)));
    expect(some.detected).not.toContain("tunnel");
  });

  test("plan question: no TTY and no --yes → exit 3, nothing applied; TTY no → exit 4", async () => {
    const a = stubs();
    const r = await init(host("fresh"), {}, a.steps);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("--yes");
    expect(a.applied).toEqual([]);
    const b = stubs();
    const no = await init(host("fresh", { tty: true, answers: [false] }), {}, b.steps);
    expect(no.code).toBe(4);
    expect(no.stdout).toContain("Dibatalkan");
    expect(b.applied).toEqual([]);
  });

  test("nothing to do: exit 0 without a question; complete steps listed", async () => {
    const s = stubs(new Set());
    const r = await init(host("fresh", { tty: true, answers: [] }), {}, s.steps);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Tidak ada yang perlu diubah.");
    expect(r.stdout).toContain("Sudah lengkap: binary panel, paket Termux");
  });

  test("each step is detected again right before apply; done meanwhile → skipped (resume)", async () => {
    const todo = new Set<InitStepId>(["binary", "runit"]);
    const s = stubs(todo, async (id) => {
      if (id === "binary") todo.delete("runit"); // binary's apply also finished runit
    });
    await init(host("fresh"), { yes: true }, s.steps);
    expect(s.applied).toEqual(["binary"]);
    expect(s.detected.filter((id) => id === "runit")).toHaveLength(2);
  });

  test("the default step list is placeholders: plan says so, running fails with exit 1 (dispatcher)", async () => {
    const stderr: string[] = [];
    const out = createCliOut({ stdout: () => {}, stderr: (t) => stderr.push(t) });
    const h = host("fresh");
    expect(await runCli(["init", "--yes"], { out, host: async () => h })).toBe(1);
    expect(stderr.join("")).toContain("belum diimplementasikan");
    expect(INIT_STEPS.map((x) => x.id)).toEqual([...INIT_STEP_IDS]);
    expect(existsSync(join(h.paths.prefix, "tmp", "panel-init.lock"))).toBe(false); // released on failure too
  });
});

describe("confirmRisky: one restart rule (K9, C22)", () => {
  /** Calls confirmRisky(action) from the binary step's apply; returns its answer or the exit code. */
  async function risky(scenario: FakeScenarioName, action: RiskyAction, flags = {}, opts: FakeHostOptions = {}) {
    let answer: boolean | undefined;
    const s = stubs(new Set(["binary"]), async (id, ctx) => {
      if (id === "binary") answer = await ctx.confirmRisky(action, "Mulai ulang?", "sv restart x");
    });
    const r = await init(host(scenario, opts), { yes: true, ...flags }, s.steps);
    return r.code === 0 ? answer : r.code;
  }

  test("restart-panel: upgrade + --yes without TTY → yes; repair/fresh → never", async () => {
    expect(await risky("upgrade", "restart-panel")).toBe(true);
    expect(await risky("fresh", "restart-panel")).toBe(false);
    const self = join(fresh(), "panel-self");
    writeFileSync(self, "\x7fELF fake panel\n"); // test-only
    expect(await risky("ready", "restart-panel", {}, { selfPath: self })).toBe(false);
  });

  test("restart-panel without --yes: the TTY asks", async () => {
    // answers: the plan question, then the restart question
    expect(await risky("upgrade", "restart-panel", { yes: false }, { tty: true, answers: [true, false] })).toBe(false);
    expect(await risky("upgrade", "restart-panel", { yes: false }, { tty: true, answers: [true, true] })).toBe(true);
  });

  test("restart-cloudflared, dns-overwrite, apt-replace: --yes without TTY → exit 3; TTY asks (--yes does not answer)", async () => {
    for (const action of ["restart-cloudflared", "dns-overwrite", "apt-replace"] as const) {
      expect(await risky("upgrade", action)).toBe(3);
      expect(await risky("fresh", action, {}, { tty: true, answers: [false] })).toBe(false);
      expect(await risky("fresh", action, {}, { tty: true, answers: [true] })).toBe(true);
    }
  });

  test("pkg-upgrade: --yes answers on a fresh phone only", async () => {
    expect(await risky("fresh", "pkg-upgrade")).toBe(true);
    expect(await risky("fresh-pg", "pkg-upgrade")).toBe(3);
  });

  test("skip-verify: --yes does not answer; --skip-verify without TTY is exit 2 before anything", async () => {
    expect(await risky("fresh", "skip-verify", {}, { tty: true, answers: [""] })).toBe(false); // default no
    const s = stubs();
    const r = await init(host("fresh"), { yes: true, "skip-verify": true }, s.steps);
    expect(r.code).toBe(2);
    expect(s.detected).toEqual([]);
  });
});

describe("lock $PREFIX/tmp/panel-init.lock (§4.1 step 0, m7, C20)", () => {
  const lockOf = (h: Host) => join(h.paths.prefix, "tmp", "panel-init.lock");

  test("held while steps run, removed after; never in $HOME; not taken by --dry-run", async () => {
    const h = host("fresh");
    let during = "";
    const s = stubs(new Set(["binary"]), async () => {
      during = readFileSync(lockOf(h), "utf8");
    });
    await init(h, { yes: true }, s.steps);
    expect(during).toBe(`${process.pid}\n`);
    expect(existsSync(lockOf(h))).toBe(false);
    expect(lockOf(h).startsWith(join(h.paths.prefix, "tmp"))).toBe(true);
    const d = host("fresh");
    expect((await init(d, { "dry-run": true })).code).toBe(0);
    expect(existsSync(join(d.paths.prefix, "tmp"))).toBe(false);
  });

  test("a live init holding the lock → exit 1; a dead or non-init pid is stale and replaced", async () => {
    const h = host("fresh");
    mkdirSync(join(h.paths.prefix, "tmp"), { recursive: true });
    writeFileSync(lockOf(h), "4242\n");
    h.proc = {
      ...h.proc,
      alive: () => true,
      list: () => [{ pid: 4242, uid: 0, exe: "/x/panel", cmdline: ["./panel", "init"] }],
    };
    const r = await init(h, { yes: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("pid 4242");
    expect(readFileSync(lockOf(h), "utf8")).toBe("4242\n");
    h.proc = { ...h.proc, list: () => [{ pid: 4242, uid: 0, exe: "/x/panel", cmdline: ["./panel", "doctor"] }] };
    expect((await init(h, { yes: true })).code).toBe(0);
    writeFileSync(lockOf(h), "4242\n");
    h.proc = { ...h.proc, alive: () => false };
    expect((await init(h, { yes: true })).code).toBe(0);
    expect(existsSync(lockOf(h))).toBe(false);
  });
});

describe("Ctrl-C during pkg (K7, §4.2)", () => {
  test("first SIGINT inside guardSigint is answered with a note, not an exit", async () => {
    let result = "";
    const s = stubs(new Set(["packages"]), async (_id, ctx) => {
      result = await ctx.guardSigint(async () => {
        process.emit("SIGINT");
        return "pkg selesai";
      });
    });
    const r = await init(host("fresh"), { yes: true }, s.steps);
    expect(r.code).toBe(0);
    expect(result).toBe("pkg selesai");
    expect(r.stderr).toContain("Ctrl-C sekali lagi");
  });
});

describe("dispatcher", () => {
  test("panel init --dry-run through runCli with the fake host", async () => {
    const stdout: string[] = [];
    const out = createCliOut({ stdout: (t) => stdout.push(t), stderr: () => {} });
    const h = host("fresh");
    expect(await runCli(["init", "--dry-run"], { out, host: async () => h })).toBe(0);
    expect(stdout.join("")).toContain("HP ini belum punya instalasi panel");
  });
});

describe("release tag (K19, C24)", () => {
  test("empty in tests/dev, and PANEL_RELEASE_TAG at run time does not change it", () => {
    const saved = process.env.PANEL_RELEASE_TAG;
    process.env.PANEL_RELEASE_TAG = "v9.9.9";
    try {
      expect(releaseTag()).toBe("");
    } finally {
      if (saved === undefined) delete process.env.PANEL_RELEASE_TAG;
      else process.env.PANEL_RELEASE_TAG = saved;
    }
    expect(SELF_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
