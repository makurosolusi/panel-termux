import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type FakeScenarioName, probePaths } from "@/cli/cli.host";
import { FAKE_NEW_VERSION, FAKE_OLD_VERSION } from "@/cli/cli.host.fake";
import { activeCliLocale, setCliLocale } from "@/cli/cli.locale";
import { runCli } from "@/cli/cli.main";
import { CliExit, createCliOut } from "@/cli/cli.output";
import { INIT_STEPS } from "@/cli/init.command";
import { languageAnswer } from "@/cli/init.language";
import { setUnfinished } from "@/cli/init.lock";
import { detectMode } from "@/cli/init.mode";
import { defineStep, INIT_EXIT, INIT_STEP_IDS, type InitStep, type InitStepId } from "@/cli/init.types";
import { init, initSandbox, snapshot, stubs } from "./cli.init.harness";

const { fresh, host } = initSandbox();

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

  test("an unfinished fresh install (marker) is fresh again, not repair, until the marker is cleared", async () => {
    const h = host("fresh-pg"); // user data present: repair without the marker
    expect((await detectMode(h)).mode).toBe("repair");
    setUnfinished(h, true);
    expect((await detectMode(h)).mode).toBe("fresh");
    setUnfinished(h, false);
    expect((await detectMode(h)).mode).toBe("repair");
  });

  test("a stale marker never bypasses downgrade or the upgrade restart; same release still resumes", async () => {
    for (const [scenario, mode] of [
      ["downgrade", "downgrade"],
      ["upgrade", "upgrade"],
      ["ready", "fresh"], // same version, other build: resume
    ] as const) {
      const h = host(scenario);
      setUnfinished(h, true);
      expect((await detectMode(h)).mode).toBe(mode);
    }
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
      expect(r.stdout).toContain("--dry-run: nothing is changed");
      expect(snapshot(h.paths.home)).toEqual(before);
      expect(h.records.filter((x) => x.kind === "run")).toEqual([]);
    });

  test("downgrade: exit 3 with the rollback hint, also in --dry-run (K20, C27)", async () => {
    for (const flags of [{ "dry-run": true }, { yes: true }]) {
      const s = stubs();
      const r = await init(host("downgrade"), flags, s.steps);
      expect(r.code).toBe(3);
      expect(r.stderr).toContain("older than the installed panel");
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
    expect(r.stdout).toContain(`Panel v${FAKE_OLD_VERSION} is installed`);
    expect(r.stdout).toContain("⚠️ action packages (not installed during an upgrade)");
    expect(r.stdout).toContain("→ run panel init again in a terminal");
  });

  test("repair without TTY (--yes too): packages, postgres, boot only reported; with TTY they run", async () => {
    const self = join(fresh(), "panel-self");
    writeFileSync(self, "\x7fELF fake panel\n"); // test-only
    const quiet = stubs();
    const r = await init(host("ready", { selfPath: self }), { yes: true }, quiet.steps);
    expect(r.code).toBe(0);
    for (const id of ["packages", "postgres", "boot"] as const) expect(quiet.applied).not.toContain(id);
    expect(r.stdout).toContain("(needs a terminal)");
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
    expect(no.stdout).toContain("Cancelled");
    expect(b.applied).toEqual([]);
  });

  test("nothing to do: exit 0 without a question; complete steps listed", async () => {
    const s = stubs(new Set());
    const r = await init(host("fresh", { tty: true, answers: [] }), {}, s.steps);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Nothing needs to change.");
    expect(r.stdout).toContain("Already complete: panel binary, Termux packages");
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

  test("the default step list is the real steps in PLAN order; fresh --yes without TTY stops at .env (exit 3)", async () => {
    const stderr: string[] = [];
    const out = createCliOut({ stdout: () => {}, stderr: (t) => stderr.push(t) });
    const self = join(fresh(), "panel-self");
    writeFileSync(self, "\x7fELF small self\n");
    const h = host("fresh", { selfPath: self });
    expect(await runCli(["init", "--yes"], { out, host: async () => h })).toBe(3);
    expect(stderr.join("")).toContain(".env is not complete");
    expect(INIT_STEPS.map((x) => x.id)).toEqual([...INIT_STEP_IDS]);
    expect(existsSync(join(h.paths.prefix, "tmp", "panel-init.lock"))).toBe(false); // released on failure too
  });
});

describe("problems left at the end (M1) and the postponed tunnel exit 3 (MINOR 6)", () => {
  const withStep = (steps: readonly InitStep[], replace: InitStep) =>
    steps.map((x) => (x.id === replace.id ? replace : x));
  const broken = (id: InitStepId, fixedBy?: () => boolean) =>
    defineStep({
      id,
      detect: async () => null,
      plan: () => (fixedBy?.() ? [] : [{ kind: "error" as const, text: `rusak ${id}`, hint: `perbaiki ${id}` }]),
      apply: async () => {},
    });

  test("only error lines, nothing to do → exit 1 with the problem, not 'Tidak ada yang perlu diubah'", async () => {
    const s = stubs(new Set());
    const r = await init(host("fresh", { tty: true }), {}, withStep(s.steps, broken("postgres")));
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain("Nothing needs to change");
    expect(r.stdout).toContain("panel init finished with problems:");
    expect(r.stdout).toContain("❌ rusak postgres");
    expect(r.stdout).not.toContain("Already complete: panel binary, Termux packages, runit, PostgreSQL");
  });

  test("other steps run, the error is still there afterwards → exit 1; fixed meanwhile → exit 0", async () => {
    const s = stubs(new Set(["binary"]));
    const r = await init(host("fresh"), { yes: true }, withStep(s.steps, broken("postgres")));
    expect(s.applied).toEqual(["binary"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("❌ rusak postgres");
    expect(r.stdout).not.toContain("✅ panel init finished.");
    let fixed = false;
    const t = stubs(new Set(["binary"]), async () => {
      fixed = true;
    });
    const ok = await init(
      host("fresh"),
      { yes: true },
      withStep(
        t.steps,
        broken("postgres", () => fixed),
      ),
    );
    expect(ok.code).toBe(0);
    expect(ok.stdout).toContain("panel init finished.");
  });

  test("tunnel exit 3 waits: boot and start still run, then exit 3 with its message; env exit 3 stops at once", async () => {
    const needs = (id: InitStepId) => async (x: InitStepId) => {
      if (x === id) throw new CliExit(INIT_EXIT.needsUser, `butuh terminal ${id}`, "jalankan di terminal");
    };
    const s = stubs(new Set(["tunnel", "boot", "start"]), needs("tunnel"));
    const r = await init(host("fresh"), { yes: true }, s.steps);
    expect(s.applied).toEqual(["tunnel", "boot", "start"]);
    expect(r.code).toBe(3);
    expect(r.stdout).toContain("❌ butuh terminal tunnel");
    const e = stubs(new Set(["env", "start"]), needs("env"));
    const stopped = await init(host("fresh"), { yes: true }, e.steps);
    expect(stopped.code).toBe(3);
    expect(e.applied).toEqual(["env"]);
  });
});

describe("language question (E12)", () => {
  const ask = { lang: undefined }; // no --lang: the question may be asked
  const envText = (h: ReturnType<typeof host>) => readFileSync(probePaths(h.paths).envFile, "utf8");
  const reset = () => setCliLocale({ locale: "en", source: "default" });

  test("answers: Enter/1 → en, 2 → id, en/id accepted, anything else asks again", () => {
    expect(["", " 1 ", "en", "2", "id", "3", "fr"].map(languageAnswer)).toEqual([
      "en",
      "en",
      "en",
      "id",
      "id",
      null,
      null,
    ]);
  });

  test("TTY without .env: asked first, PANEL_LANG=id written (mode 600) from the template, locale switched", async () => {
    reset();
    const h = host("fresh", { tty: true, answers: ["2", false] });
    const r = await init(h, ask);
    expect(r.code).toBe(4); // the second answer declined the plan question: the question did not eat it
    expect(r.stdout).toContain("Dibatalkan, tidak ada yang diubah.");
    const text = envText(h);
    expect(text).toMatch(/^PANEL_LANG=id$/m);
    expect(text).toContain("APP_BASE_URL=");
    expect(text).toContain("# --- Opsional: hapus tanda # untuk mengubah nilai bawaan ---"); // comments follow the answer
    expect(text).not.toContain("# --- Optional:");
    expect(statSync(probePaths(h.paths).envFile).mode & 0o777).toBe(0o600);
    expect(activeCliLocale()).toEqual({ locale: "id", source: "env-file" });
    reset();
  });

  test("existing .env: other lines kept, invalid answer asks again, Enter = English", async () => {
    reset();
    const h = host("fresh", { tty: true, answers: ["x", "", false] });
    const file = probePaths(h.paths).envFile;
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "APP_BASE_URL=https://panel.contoh.test\n", { mode: 0o644 }); // test-only
    const r = await init(h, ask);
    expect(r.code).toBe(4);
    expect(r.stderr).toContain("1 = English, 2 = Bahasa Indonesia");
    expect(envText(h)).toBe("APP_BASE_URL=https://panel.contoh.test\nPANEL_LANG=en\n");
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("skipped with --lang, PANEL_LANG in .env, --yes or no TTY; --dry-run asks but writes nothing", async () => {
    reset();
    const lang = host("fresh", { tty: true, answers: [false] });
    expect((await init(lang, { lang: "id" })).code).toBe(4); // the only answer went to the plan question
    expect(existsSync(probePaths(lang.paths).envFile)).toBe(false);

    const stored = host("fresh", { tty: true, answers: [false] });
    const file = probePaths(stored.paths).envFile;
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "PANEL_LANG=id\n"); // test-only
    expect((await init(stored, ask)).code).toBe(4);
    expect(envText(stored)).toBe("PANEL_LANG=id\n");

    for (const [h, flags] of [
      [host("fresh", { tty: true, answers: [] }), { ...ask, yes: true }],
      [host("fresh"), ask],
    ] as const) {
      const s = stubs(new Set());
      expect((await init(h, flags, s.steps)).code).toBe(0);
      expect(existsSync(probePaths(h.paths).envFile)).toBe(false);
    }

    const dry = host("fresh", { tty: true, answers: ["2"] });
    expect((await init(dry, { ...ask, "dry-run": true })).code).toBe(0);
    expect(existsSync(probePaths(dry.paths).envFile)).toBe(false);
    expect(activeCliLocale().locale).toBe("id"); // used for the rest of the run
    reset();
  });
});
