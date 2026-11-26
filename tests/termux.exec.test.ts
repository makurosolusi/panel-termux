import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveArgv, runTermux, TermuxExecError } from "@/server/exec/termux.exec";
import { createTarArchive } from "@/server/system/archive.tar";
import { httpStatus } from "@/server/system/net.termux";
import { createTermuxPm2 } from "@/server/system/pm2.termux";
import { createTermuxPostgres } from "@/server/system/postgres.termux";
import { createTermuxRunit } from "@/server/system/runit.termux";
import { Pm2UnavailableError } from "@/server/system/system.types";

const prefix = mkdtempSync(join(tmpdir(), "panel-prefix-"));
const bin = join(prefix, "bin");
mkdirSync(bin);
afterAll(() => rmSync(prefix, { recursive: true, force: true }));

const write = (name: string, body: string) => {
  const p = join(bin, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
};

describe("resolveArgv", () => {
  test("env shebang runs $PREFIX/bin/<interp> <script>", () => {
    const pm2 = write("pm2", "#!/usr/bin/env node\nconsole.log(1)\n");
    expect(resolveArgv("pm2", ["jlist"], prefix)).toEqual([`${prefix}/bin/node`, pm2, "jlist"]);
  });

  test("env -S shebang keeps interpreter args", () => {
    const s = write("tool", "#!/usr/bin/env -S node --no-warnings\n");
    expect(resolveArgv("tool", [], prefix)).toEqual([`${prefix}/bin/node`, "--no-warnings", s]);
  });

  test("absolute shebang and binaries run as-is via absolute path", () => {
    const s = write("bat", "#!/data/data/com.termux/files/usr/bin/sh\necho hi\n");
    expect(resolveArgv("bat", ["-x"], prefix)).toEqual([s, "-x"]);
    const elf = write("sv", "\x7fELF\x02\x01\x01binary");
    expect(resolveArgv("sv", ["status"], prefix)).toEqual([elf, "status"]);
  });

  test("absolute tool path is not re-prefixed", () => {
    const s = write("abs", "#!/bin/sh\n");
    expect(resolveArgv(s, [], prefix)).toEqual([s]);
  });

  test("missing tool throws with its path", () => {
    expect(() => resolveArgv("nope", [], prefix)).toThrow(/nope/);
  });
});

describe("runTermux", () => {
  test("returns code/stdout/stderr for an absolute tool", async () => {
    const r = await runTermux("/bin/sh", ["-c", "echo out; echo err >&2; exit 3"]);
    expect(r).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
  });

  test("times out with command name in error", async () => {
    const p = runTermux("/bin/sleep", ["5"], { timeoutMs: 100 });
    await expect(p).rejects.toThrow(TermuxExecError);
    await expect(p).rejects.toThrow(/\/bin\/sleep timed out/);
  });
});

// Adapters below run fake tools from a temp $PREFIX/bin that log their argv (spies for "CLI never called").
describe("termux adapters with fake tools", () => {
  const calls = join(prefix, "calls.log");
  const savedPrefix = process.env.PREFIX;
  beforeAll(() => {
    process.env.PREFIX = prefix;
  });
  afterAll(() => {
    if (savedPrefix === undefined) delete process.env.PREFIX;
    else process.env.PREFIX = savedPrefix;
  });
  const spy = (name: string, body = "") => write(name, `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body}\n`);
  const called = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");
  const reset = () => rmSync(calls, { force: true });

  describe("pm2 guard (B14)", () => {
    const home = join(prefix, "pm2home");
    mkdirSync(home, { recursive: true });
    const jlist = JSON.stringify([{ name: "a", pid: 9, monit: {}, pm2_env: { status: "online", pm_cwd: "/s/a" } }]);
    beforeAll(() => spy("pm2", `echo '${jlist}'`));

    const reasonOf = (p: Promise<unknown>) =>
      p.then(
        () => "resolved",
        (e) => (e instanceof Pm2UnavailableError ? e.reason : String(e)),
      );

    test("runit pm2 down → service_down for every method, CLI never spawned", async () => {
      reset();
      const pm2 = createTermuxPm2({ pm2Home: home, isSupervisorUp: async () => false });
      expect(await reasonOf(pm2.list())).toBe("service_down");
      expect(await reasonOf(pm2.procs())).toBe("service_down");
      expect(await reasonOf(pm2.control("a", "restart"))).toBe("service_down");
      expect(await reasonOf(pm2.readLog("a", "out", 5))).toBe("service_down");
      expect(await reasonOf(pm2.remove("a"))).toBe("service_down");
      expect(await reasonOf(pm2.startFromEcosystem("/x/ecosystem.config.js", "a"))).toBe("service_down");
      expect(called()).toBe("");
    });

    test("no rpc.sock, or a stale one nobody listens on → no_daemon, CLI never spawned", async () => {
      reset();
      const pm2 = createTermuxPm2({ pm2Home: home, isSupervisorUp: async () => null });
      expect(await reasonOf(pm2.list())).toBe("no_daemon");
      writeFileSync(join(home, "rpc.sock"), ""); // left behind by a crashed daemon
      expect(await reasonOf(createTermuxPm2({ pm2Home: home, isSupervisorUp: async () => true }).list())).toBe(
        "no_daemon",
      );
      rmSync(join(home, "rpc.sock"));
      expect(called()).toBe("");
    });

    test("live daemon socket → CLI runs and procs carry internal fields", async () => {
      reset();
      const daemon = Bun.listen({ unix: join(home, "rpc.sock"), socket: { data() {} } });
      try {
        const pm2 = createTermuxPm2({ pm2Home: home, isSupervisorUp: async () => true });
        expect((await pm2.procs())[0]).toMatchObject({ name: "a", cwd: "/s/a", module: false });
        expect(await pm2.list()).toEqual([expect.not.objectContaining({ cwd: expect.anything() })]);
        expect(called()).toContain("pm2 jlist");
      } finally {
        daemon.stop(true);
        rmSync(join(home, "rpc.sock"), { force: true });
      }
    });
  });

  test("runit supervise reads supervise/stat + pid without spawning sv", async () => {
    reset();
    spy("sv");
    const svdir = join(prefix, "var", "service");
    mkdirSync(join(svdir, "panel", "supervise"), { recursive: true });
    mkdirSync(join(svdir, "pm2", "supervise"), { recursive: true });
    mkdirSync(join(svdir, "fresh"), { recursive: true });
    writeFileSync(join(svdir, "panel", "supervise", "stat"), "run\n");
    writeFileSync(join(svdir, "panel", "supervise", "pid"), "4561\n");
    writeFileSync(join(svdir, "pm2", "supervise", "stat"), "down, want up\n");
    writeFileSync(join(svdir, "pm2", "supervise", "pid"), "");
    const runit = createTermuxRunit(prefix);
    expect(await runit.supervise("panel")).toEqual({ state: "run", pid: 4561 });
    expect(await runit.supervise("pm2")).toEqual({ state: "down", pid: null });
    expect(await runit.supervise("fresh")).toEqual({ state: "unknown", pid: null });
    expect(await runit.supervise("nope")).toBeNull();
    expect(await runit.supervise("..")).toBeNull();
    expect(called()).toBe("");
  });

  test("postgres restoreInto/dropDatabase/serverVersion argv", async () => {
    reset();
    spy("createdb");
    spy("pg_restore");
    spy("psql", 'case "$*" in *server_version*) echo 18.7;; *count*) echo 4;; esac');
    const pg = createTermuxPostgres();
    expect(await pg.restoreInto("/b/solusi.dump", "restore_solusi", "solusi")).toEqual({ tableCount: 4 });
    expect(await pg.serverVersion()).toBe("18.7");
    await pg.dropDatabase("restore_solusi");
    const log = called();
    expect(log).toContain("createdb -w -O solusi restore_solusi");
    expect(log).toContain("pg_restore --no-owner --role=solusi --exit-on-error -w -d restore_solusi /b/solusi.dump");
    await expect(pg.restoreInto("/b/x.dump", "bad name", "solusi")).rejects.toThrow("invalid identifier");
    await expect(pg.dropDatabase("postgres")).rejects.toThrow("maintenance database");
  });
});

describe("httpStatus", () => {
  test("sends path and Host header, null when nothing listens", async () => {
    const seen: string[] = [];
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        seen.push(`${req.headers.get("host")} ${new URL(req.url).pathname}`);
        return new Response(null, { status: new URL(req.url).pathname === "/health" ? 204 : 404 });
      },
    });
    try {
      expect(await httpStatus(server.port as number, "/health", 2000, "shop.example.test")).toBe(204);
      expect(await httpStatus(server.port as number)).toBe(404);
      expect(seen[0]).toBe("shop.example.test /health");
    } finally {
      server.stop(true);
    }
    expect(await httpStatus(server.port as number, "/", 500)).toBeNull();
  });
});

describe("tar archive", () => {
  test("archives only the given entries; nested data/app is kept", async () => {
    const src = join(prefix, "sites");
    mkdirSync(join(src, "a", "data", "app"), { recursive: true });
    writeFileSync(join(src, "a", "data", "app", "x.txt"), "keep");
    writeFileSync(join(src, "a", "app"), "binary");
    writeFileSync(join(src, "apps.json"), "[]");
    mkdirSync(join(src, "-odd"));
    const tar = createTarArchive(Bun.which("tar") ?? "/usr/bin/tar");
    const file = join(prefix, "sites.tgz");
    expect(await tar.create(file, src, ["apps.json", "a/data", "-odd"])).toEqual({ warning: null });
    await tar.list(file);
    const names = (await runTermux(Bun.which("tar") ?? "/usr/bin/tar", ["-tzf", file])).stdout.split("\n");
    expect(names).toContain("a/data/app/x.txt");
    expect(names).not.toContain("a/app");
    writeFileSync(join(prefix, "bad.tgz"), "not a tar");
    await expect(tar.list(join(prefix, "bad.tgz"))).rejects.toThrow("tar list");
    await expect(tar.create(file, src, [])).rejects.toThrow("no entries");
  });
});
