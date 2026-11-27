import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeHost, type FakeHost } from "@/cli/cli.host.fake";
import type { ParsedArgs } from "@/cli/cli.main";
import { CliExit, createCliOut } from "@/cli/cli.output";
import { type RollbackOpts, runRollback } from "@/cli/rollback.command";
import { fakeElf, GLIBC_LINKER } from "./deploy.fixture";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const NEW = "\x7fELF fake panel\n"; // what the fake scenario installs as ~/panel/panel
const OLD = Buffer.from(fakeElf({ fill: 7 })); // a valid aarch64/bionic panel.prev
const EM_X86_64 = 62;

function setup(opts: { tty?: boolean; answers?: boolean[]; prev?: Uint8Array | null; linkFails?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cli-rollback-"));
  roots.push(root);
  const { tty = false, answers = [], linkFails } = opts;
  const host = createFakeHost("ready", { root, tty, answers, linkFails });
  const dir = host.paths.panelDir;
  if (opts.prev !== null) writeFileSync(join(dir, "panel.prev"), opts.prev ?? OLD, { mode: 0o755 });
  return { host, dir, data: join(dir, "data") };
}

async function run(host: FakeHost, flags: Record<string, boolean> = {}, opts: RollbackOpts = {}) {
  let stdout = "";
  let stderr = "";
  const out = createCliOut({ stdout: (t) => (stdout += t), stderr: (t) => (stderr += t) });
  const args: ParsedArgs = { values: flags, positionals: [] };
  let code: number;
  try {
    code = await runRollback(args, { out, host: async () => host }, { healthTimeoutMs: 50, pollMs: 5, ...opts });
  } catch (e) {
    if (!(e instanceof CliExit)) throw e;
    out.fail(e.message, e.hint);
    code = e.code;
  }
  return { code, stdout, stderr, all: stdout + stderr };
}

const read = (f: string) => readFileSync(f);
const svCalls = (host: FakeHost) => host.records.filter((r) => r.argv[0] === "sv");

function makeDb(file: string, meta: Record<string, string>, marker: string) {
  const db = new Database(file, { create: true });
  db.run("CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run("CREATE TABLE marker (v TEXT)");
  for (const [k, v] of Object.entries(meta)) db.run("INSERT INTO app_meta VALUES (?, ?)", [k, v]);
  db.run("INSERT INTO marker VALUES (?)", [marker]);
  db.close();
}
const markerOf = (file: string) => {
  const db = new Database(file, { readonly: true });
  const v = (db.query("SELECT v FROM marker").get() as { v: string }).v;
  db.close();
  return v;
};

function withSnapshot(data: string, dbVersion: string, snapVersion: string) {
  mkdirSync(join(data, "snapshots"), { recursive: true });
  makeDb(join(data, "panel.db"), { panel_version: dbVersion }, "current");
  makeDb(join(data, "snapshots", `panel.db.${snapVersion}.20261126100000`), { panel_version: snapVersion }, "snap");
  makeDb(join(data, "snapshots", `panel.db.0.3.0.20261001100000`), { panel_version: "0.3.0" }, "older");
}

describe("panel rollback: refusals change nothing", () => {
  test("no ~/panel/panel → 1, hint points at panel init / the install line", async () => {
    const { host, dir } = setup();
    rmSync(join(dir, "panel"));
    const r = await run(host, { yes: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Tidak ada binary panel");
    expect(r.stderr).toContain("panel init");
    expect(r.stderr).not.toContain("install.sh");
    expect(existsSync(join(dir, "panel.prev"))).toBe(true);
    expect(svCalls(host)).toEqual([]);
  });

  test("no panel.prev → 1", async () => {
    const { host, dir } = setup({ prev: null });
    const r = await run(host, { yes: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Tidak ada versi sebelumnya");
    expect(r.stderr).toContain("panel init menyimpannya saat upgrade");
    expect(r.stderr).not.toContain("install.sh");
    expect(readFileSync(join(dir, "panel"), "utf8")).toBe(NEW);
    expect(svCalls(host)).toEqual([]);
  });

  for (const [name, prev] of [
    ["x86-64", fakeElf({ machine: EM_X86_64 })],
    ["glibc", fakeElf({ interp: GLIBC_LINKER })],
    ["not ELF", new TextEncoder().encode("#!/bin/sh\n")],
  ] as const) {
    test(`panel.prev ${name} → 1, files untouched`, async () => {
      const { host, dir } = setup({ prev });
      const r = await run(host, { yes: true });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("Tidak ada yang diubah");
      expect(readFileSync(join(dir, "panel"), "utf8")).toBe(NEW);
      expect(read(join(dir, "panel.prev")).equals(Buffer.from(prev))).toBe(true);
      expect(host.records).toEqual([]);
    });
  }

  test("no TTY and no --yes → 3", async () => {
    const { host, dir } = setup();
    const r = await run(host);
    expect(r.code).toBe(3);
    expect(r.stderr).toContain("--yes");
    expect(read(join(dir, "panel.prev")).equals(OLD)).toBe(true);
  });

  test("TTY answer no → 4", async () => {
    const { host, dir } = setup({ tty: true, answers: [false] });
    const r = await run(host);
    expect(r.code).toBe(4);
    expect(readFileSync(join(dir, "panel"), "utf8")).toBe(NEW);
    expect(svCalls(host)).toEqual([]);
  });

  test("--db without a snapshot → 1", async () => {
    const { host } = setup();
    const r = await run(host, { yes: true, db: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Tidak ada snapshot database");
  });
});

describe("panel rollback: swap", () => {
  test("both directions; panel exists after every step; panel.prev never executed; sv restart with SVDIR", async () => {
    const { host, dir } = setup({ tty: true, answers: [true] });
    const steps: string[] = [];
    const onSwapStep = (s: string) => {
      expect(existsSync(join(dir, "panel"))).toBe(true);
      expect(statSync(join(dir, "panel")).size).toBeGreaterThan(0);
      steps.push(s);
    };
    const r = await run(host, {}, { onSwapStep });
    expect(r.code).toBe(0);
    expect(steps).toHaveLength(4);
    expect(read(join(dir, "panel")).equals(OLD)).toBe(true);
    expect(readFileSync(join(dir, "panel.prev"), "utf8")).toBe(NEW);
    expect(statSync(join(dir, "panel")).mode & 0o777).toBe(0o755);
    expect(existsSync(join(dir, "panel.new")) || existsSync(join(dir, "panel.old"))).toBe(false);
    expect(r.stdout).toContain("Panel berjalan lagi");
    const sv = svCalls(host);
    expect(sv.map((c) => c.argv)).toEqual([["sv", "-w", "130", "restart", "panel"]]);
    expect(sv[0]?.envKeys).toContain("SVDIR");
    expect(host.records.filter((c) => c.kind === "run")).toEqual([]);
    expect(host.records.some((c) => c.argv.some((a) => a.includes("panel.prev")))).toBe(false);

    // Second rollback swaps back; the fake "new" binary is no ELF, so a valid one stands in for it.
    writeFileSync(join(dir, "panel.prev"), fakeElf({ fill: 9 }));
    const again = await run(host, { yes: true });
    expect(again.code).toBe(0);
    expect(read(join(dir, "panel")).equals(Buffer.from(fakeElf({ fill: 9 })))).toBe(true);
    expect(read(join(dir, "panel.prev")).equals(OLD)).toBe(true);
  });

  for (const linkFails of [true, false])
    test(`link ${linkFails ? "refused like Termux (E9) → copy" : "allowed → hard link"}; panel never missing`, async () => {
      const { host, dir } = setup({ linkFails });
      const [cur, old] = [join(dir, "panel"), join(dir, "panel.old")];
      const ino = statSync(cur).ino;
      const seen: string[] = [];
      const onSwapStep = (s: string) => {
        expect(read(cur).length).toBeGreaterThan(0);
        expect(existsSync(`${old}.tmp`)).toBe(false);
        if (seen.push(s) === 2) {
          expect(read(old).toString()).toBe(NEW);
          expect(statSync(old).ino === ino).toBe(!linkFails);
        }
      };
      const r = await run(host, { yes: true }, { onSwapStep });
      expect(r.code).toBe(0);
      expect(seen).toHaveLength(4);
      expect(read(cur).equals(OLD)).toBe(true);
      expect(readFileSync(join(dir, "panel.prev"), "utf8")).toBe(NEW);
    });

  test("leftover panel.old copy with panel's bytes (Termux crash before rename) and panel.old.tmp → removed", async () => {
    const { host, dir } = setup();
    writeFileSync(join(dir, "panel.old"), NEW);
    writeFileSync(join(dir, "panel.old.tmp"), "partial copy");
    const r = await run(host, { yes: true });
    expect(r.code).toBe(0);
    expect(read(join(dir, "panel")).equals(OLD)).toBe(true);
    expect(readFileSync(join(dir, "panel.prev"), "utf8")).toBe(NEW);
    expect(existsSync(join(dir, "panel.old")) || existsSync(join(dir, "panel.old.tmp"))).toBe(false);
  });

  test("leftover panel.old of the same file (crash before rename) is removed and the swap runs", async () => {
    const { host, dir } = setup();
    linkSync(join(dir, "panel"), join(dir, "panel.old"));
    const r = await run(host, { yes: true });
    expect(r.code).toBe(0);
    expect(read(join(dir, "panel")).equals(OLD)).toBe(true);
    expect(existsSync(join(dir, "panel.old"))).toBe(false);
  });

  test("leftover panel.old of another file (crash after rename) finishes that swap and stops → 1", async () => {
    const { host, dir } = setup();
    writeFileSync(join(dir, "panel.old"), "previous running binary");
    const r = await run(host, { yes: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("terputus");
    expect(readFileSync(join(dir, "panel.prev"), "utf8")).toBe("previous running binary");
    expect(existsSync(join(dir, "panel.old"))).toBe(false);
    expect(svCalls(host)).toEqual([]);
  });

  test("panel not answering after restart → 1 with the log path", async () => {
    const { host } = setup();
    const sys = host.system();
    const down: FakeHost = { ...host, system: () => ({ ...sys, net: { ...sys.net, httpStatus: async () => null } }) };
    const r = await run(down, { yes: true });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("belum menjawab /api/health");
    expect(r.stderr).toContain("sv/panel/current");
  });
});

describe("panel rollback: database", () => {
  test("warns when the DB was migrated by a newer version than the latest snapshot", async () => {
    const { host, data } = setup();
    withSnapshot(data, "0.5.0", "0.4.0");
    const r = await run(host, { yes: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Database sudah dimigrasi oleh v0.5.0");
    expect(r.stdout).toContain("panel rollback --db");
    expect(markerOf(join(data, "panel.db"))).toBe("current");
  });

  test("no warning when the DB version matches the latest snapshot", async () => {
    const { host, data } = setup();
    withSnapshot(data, "0.4.0", "0.4.0");
    const r = await run(host, { yes: true });
    expect(r.stdout).not.toContain("sudah dimigrasi");
  });

  test("--db: sv down, before-rollback copy (600) first, newest snapshot in place, -wal/-shm gone", async () => {
    const { host, data } = setup();
    withSnapshot(data, "0.5.0", "0.4.0");
    writeFileSync(join(data, "panel.db-wal"), "");
    writeFileSync(join(data, "panel.db-shm"), "");
    const now = new Date(2026, 10, 27, 12, 0, 0);
    const r = await run(host, { yes: true, db: true }, { now });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("perubahan data setelah waktu itu hilang");
    expect(r.stdout).toContain("2026-11-26 10:00:00");
    const backup = join(data, "snapshots", "panel.db.before-rollback.20261127120000");
    expect(markerOf(backup)).toBe("current");
    expect(statSync(backup).mode & 0o777).toBe(0o600);
    expect(markerOf(join(data, "panel.db"))).toBe("snap");
    expect(existsSync(join(data, "panel.db-wal"))).toBe(false);
    expect(existsSync(join(data, "panel.db-shm"))).toBe(false);
    expect(svCalls(host).map((c) => c.argv[3])).toEqual(["down", "restart"]);
  });
});
