import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveArgv, runTermux, TermuxExecError } from "@/server/exec/termux.exec";

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
