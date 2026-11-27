// runit start/`down` + supervise uptime and cloudflared `route dns` (PLAN/06 §6.1, §6.4 B) with fake tools in $PREFIX/bin.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTermuxCloudflared, parseRouteDns } from "@/server/system/cloudflared.termux";
import { createTermuxRunit, uptimeFromStatus } from "@/server/system/runit.termux";
import { DnsWrongZoneError, SystemError } from "@/server/system/system.types";

const prefix = mkdtempSync(join(tmpdir(), "panel-termux-sys-"));
const bin = join(prefix, "bin");
const calls = join(prefix, "calls.log");
const svdir = join(prefix, "var", "service");
mkdirSync(bin);
const savedPrefix = process.env.PREFIX;
beforeAll(() => {
  process.env.PREFIX = prefix;
});
afterAll(() => {
  if (savedPrefix === undefined) delete process.env.PREFIX;
  else process.env.PREFIX = savedPrefix;
  rmSync(prefix, { recursive: true, force: true });
});

/** Fake tool logging its argv (and whether `<svdir>/pm2/down` existed at that moment) before running `body`. */
const spy = (name: string, body = "") => {
  const p = join(bin, name);
  writeFileSync(
    p,
    `#!/bin/sh\necho "${name} $* down=$([ -e "${svdir}/pm2/down" ] && echo y || echo n)" >> "${calls}"\n${body}\n`,
  );
  chmodSync(p, 0o755);
};
const called = () => (existsSync(calls) ? readFileSync(calls, "utf8") : "");

/** runsv `supervise/status`: TAI64N of the start (2^62 + 10 + unix s), then pid and flags (20 bytes). */
const statusBytes = (startUnixSec: number) => {
  const b = Buffer.alloc(20);
  b.writeBigUInt64BE(2n ** 62n + 10n + BigInt(startUnixSec), 0);
  b.writeUInt32LE(4321, 12);
  return b;
};

describe("runit supervise uptime", () => {
  test("uptimeFromStatus: seconds since the TAI64 start; short or future status → null", () => {
    const now = 1_800_000_000_000;
    expect(uptimeFromStatus(statusBytes(now / 1000 - 3600), now)).toBe(3600);
    expect(uptimeFromStatus(Buffer.alloc(8), now)).toBeNull();
    expect(uptimeFromStatus(statusBytes(now / 1000 + 60), now)).toBeNull();
  });

  test("supervise adds uptimeSec only while the service runs and status is readable", async () => {
    for (const name of ["pm2", "old", "down"]) mkdirSync(join(svdir, name, "supervise"), { recursive: true });
    const sup = (name: string, stat: string, status?: Buffer) => {
      writeFileSync(join(svdir, name, "supervise", "stat"), stat);
      writeFileSync(join(svdir, name, "supervise", "pid"), "77\n");
      if (status) writeFileSync(join(svdir, name, "supervise", "status"), status);
    };
    sup("pm2", "run\n", statusBytes(Math.floor(Date.now() / 1000) - 120));
    sup("old", "run\n"); // runit without a status file: no uptime, nothing invented
    sup("down", "down\n", statusBytes(Math.floor(Date.now() / 1000) - 120));
    const runit = createTermuxRunit(prefix);
    const pm2 = await runit.supervise("pm2");
    expect(pm2).toMatchObject({ state: "run", pid: 77 });
    expect(pm2?.uptimeSec).toBeGreaterThanOrEqual(120);
    expect(pm2?.uptimeSec).toBeLessThan(130);
    expect(await runit.supervise("old")).toEqual({ state: "run", pid: 77 });
    expect(await runit.supervise("down")).toEqual({ state: "down", pid: null });
  });
});

describe("runit start removes `down` (PLAN/06 F8)", () => {
  test("removeDown: the down file is gone before sv start runs; without it the file stays", async () => {
    spy("sv", 'echo "run: $2: (pid 99) 0s"');
    mkdirSync(join(svdir, "pm2"), { recursive: true });
    const down = join(svdir, "pm2", "down");
    writeFileSync(down, "");
    const runit = createTermuxRunit(prefix);
    expect(await runit.control("pm2", "start")).toMatchObject({ name: "pm2", state: "run" });
    expect(existsSync(down)).toBe(true);
    rmSync(calls, { force: true });
    expect(await runit.control("pm2", "start", { removeDown: true })).toMatchObject({ state: "run", pid: 99 });
    expect(existsSync(down)).toBe(false);
    expect(called().split("\n")[0]).toBe("sv start pm2 down=n");
    // No down file at all is fine too; stop never touches it.
    expect(await runit.control("pm2", "start", { removeDown: true })).toMatchObject({ state: "run" });
    writeFileSync(down, "");
    await runit.control("pm2", "stop", { removeDown: true });
    expect(existsSync(down)).toBe(true);
    expect(await runit.control("nope", "start", { removeDown: true })).toBeNull();
  });
});

describe("cloudflared route dns (PLAN/06 §6.4 B, gate G0)", () => {
  const ADDED = "2026-11-27T01:02:03Z INF Added CNAME blog.contoh.com which will route to this tunnel tunnelID=t1";
  const EXISTS = "2026-11-27T01:02:03Z INF blog.contoh.com is already configured to route to your tunnel tunnelID=t1";

  test("parseRouteDns: both success lines; the name must equal the hostname", () => {
    expect(parseRouteDns(ADDED, "blog.contoh.com")).toEqual({ created: true });
    expect(parseRouteDns(EXISTS, "blog.contoh.com")).toEqual({ created: false });
    expect(parseRouteDns(ADDED, "Blog.Contoh.com.")).toEqual({ created: true }); // DNS names are case-insensitive
    const wrong = (() => {
      try {
        return parseRouteDns(ADDED.replace("blog.contoh.com", "blog.lain.test.contoh.com"), "blog.lain.test");
      } catch (e) {
        return e;
      }
    })();
    expect(wrong).toBeInstanceOf(DnsWrongZoneError);
    expect((wrong as DnsWrongZoneError).fqdn).toBe("blog.lain.test.contoh.com");
    expect(() => parseRouteDns("INF something else", "blog.contoh.com")).toThrow(SystemError);
  });

  test("routeDns argv has no --overwrite-dns; output is read from stderr; exit ≠ 0 → SystemError", async () => {
    rmSync(calls, { force: true });
    spy("cloudflared", `echo "${ADDED}" >&2`);
    const cf = createTermuxCloudflared(join(prefix, "config.yml"));
    expect(await cf.routeDns("t1", "blog.contoh.com")).toEqual({ created: true });
    expect(called()).toContain("cloudflared tunnel route dns t1 blog.contoh.com");
    expect(called()).not.toContain("overwrite");
    spy("cloudflared", 'echo "ERR An A, AAAA, or CNAME record with that host already exists" >&2; exit 1');
    await expect(cf.routeDns("t1", "blog.contoh.com")).rejects.toThrow(/exited 1: .*already exists/);
  });
});
