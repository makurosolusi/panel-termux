import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FakeScenarioName } from "@/cli/cli.host";
import type { FakeHostOptions } from "@/cli/cli.host.fake";
import { setCliLocale } from "@/cli/cli.locale";
import { runCli } from "@/cli/cli.main";
import { createCliOut } from "@/cli/cli.output";
import { releaseTag, SELF_VERSION } from "@/cli/init.mode";
import type { RiskyAction } from "@/cli/init.types";
import { type Host, init, initSandbox, stubs } from "./cli.init.harness";

const { fresh, host } = initSandbox();

describe("confirmRisky: one restart rule (K9, C22)", () => {
  /** Calls confirmRisky(action) from the binary step's apply; returns its answer or the exit code. */
  async function risky(scenario: FakeScenarioName, action: RiskyAction, flags = {}, opts: FakeHostOptions = {}) {
    let answer: boolean | undefined;
    const s = stubs(new Set(["binary"]), async (id, ctx) => {
      if (id === "binary") answer = await ctx.confirmRisky(action, "Restart?", "sv restart x");
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

describe("lock ownership (MINOR 4)", () => {
  test("release leaves a lock that another init holds now; a stale lock rewritten meanwhile is not removed", async () => {
    const h = host("fresh");
    const lock = join(h.paths.prefix, "tmp", "panel-init.lock");
    const s = stubs(new Set(["binary"]), async () => {
      writeFileSync(lock, "4343\n"); // removed by hand and taken by another init while we ran
    });
    expect((await init(h, { yes: true }, s.steps)).code).toBe(0);
    expect(readFileSync(lock, "utf8")).toBe("4343\n");
    // stale pid 4343; a racing init replaces it with its live pid 4444 between our read and our rm
    h.proc = {
      ...h.proc,
      alive: (pid) => {
        if (pid === 4343) writeFileSync(lock, "4444\n"); // checked stale; the racer writes its lock right then
        return pid === 4444;
      },
      list: () => [{ pid: 4444, uid: 0, exe: "/x/panel", cmdline: ["./panel", "init"] }],
    };
    const r = await init(h, { yes: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("pid 4444");
    expect(readFileSync(lock, "utf8")).toBe("4444\n");
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
    expect(r.stderr).toContain("Ctrl-C once more");
  });
});

describe("dispatcher", () => {
  test("panel init --dry-run through runCli with the fake host", async () => {
    const stdout: string[] = [];
    const out = createCliOut({ stdout: (t) => stdout.push(t), stderr: () => {} });
    const h = host("fresh");
    expect(await runCli(["init", "--dry-run"], { out, host: async () => h })).toBe(0);
    expect(stdout.join("")).toContain("This phone has no panel installed yet");
  });

  test("--lang id: plan header, a step's plan line, run header and summary in Indonesian", async () => {
    const stdout: string[] = [];
    const out = createCliOut({ stdout: (t) => stdout.push(t), stderr: () => {} });
    try {
      expect(await runCli(["init", "--lang", "id", "--dry-run"], { out, host: async () => host("fresh") })).toBe(0);
      const plan = stdout.join("");
      expect(plan).toContain(`Panel Termux ${SELF_VERSION} — penyiapan HP (--dry-run: tidak ada yang diubah)`);
      expect(plan).toContain("HP ini belum punya instalasi panel. Yang akan dilakukan:");
      expect(plan).toContain("Menyalakan runit (pengelola layanan Termux)");
      expect(plan).not.toContain("What will be done");
      // runCli set the locale for this run; runInit (the harness) keeps it
      const r = await init(host("fresh"), { yes: true, lang: "id" }, stubs(new Set(["packages"])).steps);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("\nPaket Termux\n");
      expect(r.stdout).toContain("Sudah lengkap: binary panel, runit, PostgreSQL");
      expect(r.stdout).toContain("✅ panel init selesai.");
    } finally {
      setCliLocale({ locale: "en", source: "default" });
    }
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
