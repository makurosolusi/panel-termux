import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CliHost, type FakeScenarioName, type ProcInfo, probePaths } from "@/cli/cli.host";
import { createFakeHost, FAKE_PANEL_PID, type FakeHost } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { doctorCommand, openDoctorDb, runDoctor } from "@/cli/doctor.command";
import { openDb } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setting } from "@/server/db/schema";
import { TermuxExecError } from "@/server/exec/termux.exec";
import type { DoctorKey, DoctorReport } from "@/shared/doctor.types";
import { idSiteSetup } from "@/web/i18n/id.site.setup";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-doctor-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

/** Fake host in its own sandbox; panel scenarios get the apps.json a booted panel would have made (ensureAppsJson). */
function host(scenario: FakeScenarioName, arrange?: (root: string) => void): FakeHost {
  const root = join(tmp, String(n++));
  mkdirSync(join(root, "sites"), { recursive: true });
  if (scenario !== "fresh") writeFileSync(join(root, "sites", "apps.json"), "[]\n"); // test-only
  arrange?.(root);
  return createFakeHost(scenario, { root });
}
const root = (h: CliHost) => h.paths.home;
const silent = createCliOut({ stdout: () => {}, stderr: () => {} });
const doctor = (h: CliHost) => runDoctor(h, silent);
const get = (r: DoctorReport, key: DoctorKey) => r.checks.find((c) => c.key === key);
const stateOf = async (h: CliHost, key: DoctorKey) => get(await doctor(h), key)?.state;

async function run(h: CliHost, json = false) {
  let stdout = "";
  let stderr = "";
  const out = createCliOut({ stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) });
  const code = await doctorCommand({ values: { json }, positionals: [] }, { out, host: async () => h });
  return { code, stdout, stderr };
}

/** Every path under `dir` with size + mtime (a write or a new file changes it). */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((rel) => {
      const s = statSync(join(dir, rel));
      return `${rel} ${s.isDirectory() ? "d" : s.size} ${s.mtimeMs}`;
    })
    .sort();
}

/** CliHost with some exec answers replaced. */
const withExec = (h: CliHost, answer: (tool: string, args: readonly string[]) => unknown): CliHost => ({
  ...h,
  exec: async (tool, args = [], opts) => {
    const a = answer(tool, args);
    if (a instanceof Error) throw a;
    return (a as Awaited<ReturnType<CliHost["exec"]>>) ?? h.exec(tool, args, opts);
  },
});

describe("scenarios (PLAN/07 §3.1, §9)", () => {
  test("fresh: missing packages and binary are errors, exit 1", async () => {
    const r = await run(host("fresh"));
    expect(r.code).toBe(1);
    const report = await doctor(host("fresh"));
    for (const k of [
      "pkg_termux_services",
      "pkg_cloudflared",
      "node",
      "pm2",
      "binary_installed",
      "env_complete",
    ] as const)
      expect(get(report, k)?.state).toBe("error");
    expect(get(report, "pkg_cloudflared")?.hint).toBe("jalankan: pkg install cloudflared");
    expect(get(report, "pkg_cloudflared")?.action).toBe("manual");
    expect(r.stdout).toContain("❌ cloudflared belum terpasang\n     → jalankan: pkg install cloudflared");
  });

  test("ready: no error, exit 0, panel healthy line", async () => {
    const r = await run(host("ready"));
    expect(r.stdout).not.toContain("❌");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Panel Termux");
    expect(r.stdout).toContain("Checklist penyiapan ada di Administrasi → Penyiapan");
    expect(r.stdout).toMatch(/Hasil: 0 error, \d+ peringatan\./);
  });

  test("nosv: termux-services missing is an error and no service reads as running (D1)", async () => {
    const report = await doctor(host("nosv"));
    expect(get(report, "pkg_termux_services")?.state).toBe("error");
    for (const k of ["service_daemon", "svc_panel", "svc_pm2", "svc_cloudflared"] as const)
      expect(get(report, k)?.state).toBe("error");
    expect(get(report, "svc_postgres")?.state).toBe("warning");
    expect(report.ok).toBe(false);
  });

  test("poco: spreads check fails with the Persiapan card's own label; holds are ok", async () => {
    const report = await doctor(host("poco"));
    const c = get(report, "ecosystem_spreads_apps_json");
    expect(c?.state).toBe("error");
    expect(c?.group).toBe("situs");
    expect(c?.label).toBe(idSiteSetup.checks.ecosystem_spreads_apps_json.error(c?.params ?? {}));
    expect(c?.hint).toStartWith("buka Situs → Persiapan");
    expect(c?.action).toBe("ui");
    expect(get(report, "pkg_held")?.state).toBe("ok");
  });
});

describe("bootstrap checks", () => {
  test("0.4.0 .env.example counts as empty: env_complete names all four (D7)", async () => {
    const h = host("ready", (r) => {
      mkdirSync(join(r, "panel"), { recursive: true });
      writeFileSync(
        join(r, "panel", ".env"),
        "APP_BASE_URL=https://panel.example.com\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\nSUPER_ADMIN_EMAILS=you@example.com\nPORT=3200\n",
      );
    });
    const c = get(await doctor(h), "env_complete");
    expect(c?.state).toBe("error");
    expect(c?.label).toBe(
      ".env belum lengkap: APP_BASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPER_ADMIN_EMAILS",
    );
  });

  test("invalid .env names the variable, never the value", async () => {
    const h = host("ready", (r) => {
      mkdirSync(join(r, "panel"), { recursive: true });
      const bad = "GOOGLE_CLIENT_ID=x\nGOOGLE_CLIENT_SECRET=s3cr3t-sentinel\nSUPER_ADMIN_EMAILS=a@b.co\n"; // test-only
      writeFileSync(join(r, "panel", ".env"), `APP_BASE_URL=ftp://s3cr3t-sentinel\n${bad}`);
    });
    const r = await run(h, true);
    const c = get(JSON.parse(r.stdout), "env_valid");
    expect(c?.state).toBe("error");
    expect(c?.label).toContain("APP_BASE_URL");
    expect(r.stdout + r.stderr).not.toContain("s3cr3t-sentinel");
  });

  test("pkg_held: installed but not held → warning naming the packages", async () => {
    const h = withExec(host("ready"), (t) =>
      t === "apt-mark" ? { code: 0, stdout: "postgresql\n", stderr: "" } : null,
    );
    const c = get(await doctor(h), "pkg_held");
    expect(c?.state).toBe("warning");
    expect(c?.params).toEqual({ packages: "cloudflared" });
    expect(c?.hint).toContain("panel docs paket");
  });

  test("postgres_major: PG_VERSION major differs from postgres --version (D11)", async () => {
    const h = host("ready", (r) => {
      const f = probePaths({ home: r, prefix: join(r, "usr"), svdir: "", logdir: "", panelDir: "" }).pgVersion;
      mkdirSync(join(f, ".."), { recursive: true });
      writeFileSync(f, "16\n");
    });
    const c = get(await doctor(h), "postgres_major");
    expect(c?.state).toBe("error");
    expect(c?.params).toEqual({ data: "16", program: "17" });
  });

  test("cloudflared_down_file: error with config.yml, warning without (D5)", async () => {
    const down = (r: string) => writeFileSync(join(r, "usr", "var", "service", "cloudflared", "down"), "");
    const h = host("ready");
    down(root(h));
    expect(await stateOf(h, "cloudflared_down_file")).toBe("error");
    rmSync(join(root(h), ".cloudflared", "config.yml"));
    expect(await stateOf(h, "cloudflared_down_file")).toBe("warning");
    expect(await stateOf(host("ready"), "cloudflared_down_file")).toBe("ok");
  });

  test("cloudflared_run_script: the package template (--token-file) is a warning", async () => {
    const h = host("ready");
    const run = join(root(h), "usr", "var", "service", "cloudflared", "run");
    writeFileSync(run, "#!/bin/sh\nexec cloudflared tunnel run --token-file $HOME/.cloudflared/token\n");
    expect(await stateOf(h, "cloudflared_run_script")).toBe("warning");
  });

  test("env_extra_files: .env.local in ~/panel → warning, content not read (D8)", async () => {
    const h = host("ready", (r) => {
      mkdirSync(join(r, "panel"), { recursive: true });
      writeFileSync(join(r, "panel", ".env.local"), "GOOGLE_CLIENT_SECRET=s3cr3t-sentinel\n"); // test-only
      writeFileSync(join(r, "panel", ".env.prod.local"), "");
    });
    const r = await run(h, true);
    const c = get(JSON.parse(r.stdout), "env_extra_files");
    expect(c?.state).toBe("warning");
    expect(c?.params).toEqual({ files: ".env.local, .env.prod.local" });
    expect(r.stdout).not.toContain("s3cr3t-sentinel");
  });

  test("app_termux_boot/api: missing → warning, cmd timeout → info (m2)", async () => {
    const missing = withExec(host("ready"), (t) => (t.endsWith("cmd") ? { code: 0, stdout: "", stderr: "" } : null));
    expect(await stateOf(missing, "app_termux_boot")).toBe("warning");
    const timeout = withExec(host("ready"), (t) =>
      t.endsWith("cmd") ? new TermuxExecError("exec cmd timed out") : null,
    );
    const report = await doctor(timeout);
    expect(get(report, "app_termux_boot")?.state).toBe("info");
    expect(get(report, "app_termux_api")?.state).toBe("info");
  });

  test("termux_source: Play Store → error, unset → info (m3)", async () => {
    const play = { ...host("ready"), termuxEnv: { TERMUX_APK_RELEASE: "GOOGLE_PLAY_STORE" } };
    expect(await stateOf(play, "termux_source")).toBe("error");
    expect(await stateOf({ ...host("ready"), termuxEnv: {} }, "termux_source")).toBe("info");
  });

  test("pkg_manager_apt from files, pacman only with env + binary (m1)", async () => {
    const h = host("ready");
    const p = probePaths(h.paths);
    rmSync(p.apt);
    expect(get(await doctor(h), "pkg_manager_apt")?.label).toBe("apt tidak ditemukan di Termux");
    writeFileSync(p.pacman, "");
    const pac = { ...h, termuxEnv: { ...h.termuxEnv, TERMUX_APP_PACKAGE_MANAGER: "pacman" } };
    expect(get(await doctor(pac), "pkg_manager_apt")?.label).toContain("pacman");
  });

  test("panel_instances: two serve processes → error; one outside runit → warning; CLI runs ignored", async () => {
    const h = host("ready");
    const proc = (pid: number, cmdline: string[], exe = probePaths(h.paths).binary): ProcInfo => ({
      pid,
      uid: h.proc.uid,
      exe,
      cmdline,
    });
    const procs = (list: ProcInfo[]): CliHost => ({ ...h, proc: { ...h.proc, list: () => list } });
    const two = [proc(FAKE_PANEL_PID, ["./panel"]), proc(4242, ["./panel.prev", "serve"], "/x/panel.prev")];
    const c = get(await doctor(procs(two)), "panel_instances");
    expect(c?.state).toBe("error");
    expect(c?.params).toEqual({ count: 2 });
    expect(await stateOf(procs([proc(4242, ["./panel"])]), "panel_instances")).toBe("warning");
    const cli = [proc(FAKE_PANEL_PID, ["./panel"]), proc(4243, ["./panel", "doctor"]), proc(4244, ["node"], "/x/node")];
    expect(await stateOf(procs(cli), "panel_instances")).toBe("ok");
  });
});

describe("read-only (K12, lab L6)", () => {
  test("doctor creates or changes no file in the sandbox", async () => {
    for (const scenario of ["fresh", "ready", "poco", "nosv"] as const) {
      const h = host(scenario);
      h.system(); // the fake system seeds its sandbox on creation; doctor itself must add nothing
      const before = snapshot(root(h));
      await run(h);
      await run(h, true);
      expect(snapshot(root(h))).toEqual(before);
      expect(existsSync(join(root(h), "panel", "data", "panel.db"))).toBe(false);
    }
  });

  /** A real panel.db in WAL mode under the fake's data dir, sites.dir set so the read is visible. */
  const withDb = (h: FakeHost, dropShm: boolean) => {
    const data = probePaths(h.paths).dataDir;
    const db = openDb(data);
    runMigrations(db);
    db.insert(setting)
      .values({ key: "sites.dir", value: join(root(h), "elsewhere") })
      .run();
    db.$client.run("PRAGMA wal_checkpoint(PASSIVE)");
    db.$client.close();
    writeFileSync(join(data, "panel.db-wal"), "", { flag: "a" });
    if (dropShm) rmSync(join(data, "panel.db-shm"), { force: true });
    else writeFileSync(join(data, "panel.db-shm"), "", { flag: "a" });
  };

  test("panel.db with -shm: opened read-only, settings are the panel's, no file added", async () => {
    const h = host("ready");
    withDb(h, false);
    h.system();
    const before = snapshot(root(h));
    const c = get(await doctor(h), "sites_dir");
    expect(c?.params.path).toBe(join(root(h), "elsewhere"));
    expect(snapshot(root(h))).toEqual(before);
  });

  test("panel.db with -wal but no -shm: not opened (:memory:), plain note, no -shm created", async () => {
    const h = host("ready");
    withDb(h, true);
    h.system();
    const before = snapshot(root(h));
    const r = await run(h, true);
    expect(snapshot(root(h))).toEqual(before);
    expect(r.stderr).toContain("panel.db tidak dibuka");
    expect(get(JSON.parse(r.stdout), "sites_dir")?.params.path).toBe(join(root(h), "sites"));
  });

  test("openDoctorDb without panel.db gives a migrated in-memory DB", () => {
    const { db, note } = openDoctorDb(join(tmp, "nothing-here"));
    expect(note).toBeNull();
    expect(db.$client.filename).toBe(":memory:");
    db.$client.close();
    expect(existsSync(join(tmp, "nothing-here"))).toBe(false);
  });
});

describe("--json (§3.2, D15)", () => {
  test("whole stdout parses as a DoctorReport even when a module logs to console.log", async () => {
    const noisy = withExec(host("poco"), () => {
      console.log("[panel] noise that must not reach stdout");
      return null;
    });
    const r = await run(noisy, true);
    const report = JSON.parse(r.stdout) as DoctorReport;
    expect(report.schema).toBe(1);
    expect(report.mode).toBe("fake");
    expect(report.ok).toBe(false);
    expect(r.code).toBe(1);
    const sum = report.summary;
    expect(sum.ok + sum.warning + sum.error + sum.info).toBe(report.checks.length);
    for (const c of report.checks) {
      expect(Object.keys(c).sort()).toEqual(["action", "group", "hint", "key", "label", "params", "state"]);
      expect(["ok", "warning", "error", "info"]).toContain(c.state);
      expect([null, "init", "ui", "manual", "docs"]).toContain(c.action);
      if (c.state === "error" || c.state === "warning") expect(c.hint).toBeTruthy();
    }
    expect(new Set(report.checks.map((c) => c.key)).size).toBe(report.checks.length);
  });

  test("no secret from .env and no nano/ssh instruction in any output", async () => {
    for (const json of [false, true]) {
      const r = await run(host("ready"), json);
      const all = r.stdout + r.stderr;
      expect(all).not.toContain("fake-client-secret");
      expect(all).not.toMatch(/\bnano\b|\bssh\b/);
    }
  });
});
