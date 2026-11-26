import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { BinaryError, detectRuntime, detectRuntimeBuffer } from "@/server/deploy/elf.runtime";
import {
  ensureAppsEntry,
  panelAppEntry,
  runScriptText,
  scriptRuntimeOf,
  writeRunScript,
} from "@/server/deploy/run.script";
import { compileTiny, fakeElf, GLIBC_LINKER } from "./deploy.fixture";

const dir = mkdtempSync(join(tmpdir(), "panel-elf-test-"));
const file = (name: string, data: Uint8Array | string) => {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
};
const compiled: string[] = [];
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const p of compiled) rmSync(dirname(p), { recursive: true, force: true });
});

describe("detectRuntime on real bun --compile binaries", () => {
  let android = "";
  let glibc = "";
  beforeAll(() => {
    android = compileTiny("bun-linux-arm64-android");
    glibc = compileTiny("bun-linux-arm64");
    compiled.push(android, glibc);
  }, 60_000);

  test("bun-linux-arm64-android → native", () => expect(detectRuntime(android)).toBe("native"));
  test("bun-linux-arm64 (glibc) → grun", () => expect(detectRuntime(glibc)).toBe("grun"));
});

describe("detectRuntime on crafted headers", () => {
  test("android linker / glibc linker / static", () => {
    expect(detectRuntime(file("a", fakeElf()))).toBe("native");
    expect(detectRuntime(file("g", fakeElf({ interp: GLIBC_LINKER })))).toBe("grun");
    expect(detectRuntime(file("s", fakeElf({ interp: null })))).toBe("native");
  });

  test.each([
    ["not ELF", "#!/bin/sh\necho hi\n".padEnd(100, " "), /not an ELF/],
    ["too short", "\x7fELF", /not an ELF/],
    ["x86-64", fakeElf({ machine: 62 }), /machine 62 is not aarch64/],
    ["musl", fakeElf({ interp: "/lib/ld-musl-aarch64.so.1" }), /unsupported ELF interpreter/],
  ] as const)("%s is rejected", (_label, data, msg) => {
    const p = file(`bad-${_label}`, data);
    expect(() => detectRuntime(p)).toThrow(BinaryError);
    expect(() => detectRuntime(p)).toThrow(msg);
  });

  test("truncated program headers", () => {
    const p = file("trunc", fakeElf().subarray(0, 80));
    expect(() => detectRuntime(p)).toThrow(/truncated/);
  });
});

describe("coded reasons (API invalid_binary.reason) from a buffer", () => {
  test.each([
    ["not_elf", new TextEncoder().encode("#!/bin/sh\n".padEnd(100, " "))],
    [
      "not_64le",
      (() => {
        const b = fakeElf();
        b[4] = 1;
        return b;
      })(),
    ],
    ["not_aarch64", fakeElf({ machine: 62 })],
    ["interp", fakeElf({ interp: "/lib/ld-musl-aarch64.so.1" })],
    ["truncated", fakeElf().subarray(0, 80)],
  ] as const)("%s", (reason, data) => {
    expect(() => detectRuntimeBuffer(data)).toThrow(BinaryError);
    try {
      detectRuntimeBuffer(data);
    } catch (e) {
      expect((e as BinaryError).reason).toBe(reason);
    }
  });

  test("chunk 0 alone is enough (headers sit at the start)", () => {
    expect(detectRuntimeBuffer(fakeElf({ interp: GLIBC_LINKER, size: 2000 }))).toBe("grun");
  });
});

describe("run script and the fixed pm2 entry (D6)", () => {
  test("run text from the runtime", () => {
    expect(runScriptText("native", "/p")).toBe(
      '#!/p/bin/sh\n# Panel Termux: written from the ELF header of ./app (native) on every deploy.\nexec ./app "$@"\n',
    );
    expect(runScriptText("grun", "/p")).toContain('exec /p/bin/grun ./app "$@"');
  });

  test("writeRunScript writes 0755 atomically, then reports unchanged", () => {
    const d = join(dir, "site-run");
    mkdirSync(d);
    expect(writeRunScript(d, "grun")).toEqual({ changed: true, previous: null });
    expect(statSync(join(d, "run")).mode & 0o777).toBe(0o755);
    expect(writeRunScript(d, "grun").changed).toBe(false);
    expect(writeRunScript(d, "native").changed).toBe(true);
  });

  test("ensureAppsEntry: registered, unchanged, migrated from an old ./app or grun entry; others kept", () => {
    const other = { name: "other", script: "x" };
    const added = ensureAppsEntry(JSON.stringify([other]), "shop", "/s/shop");
    expect(added.code).toBe("apps_registered");
    expect(JSON.parse(added.text as string)).toEqual([other, panelAppEntry("shop", "/s/shop")]);
    expect(ensureAppsEntry(added.text, "shop", "/s/shop")).toEqual({ text: null, code: "apps_unchanged" });
    const old = JSON.stringify([
      { name: "shop", cwd: "/s/shop", script: "/p/bin/grun", args: ["./app"], env: { PORT: "1" } },
    ]);
    const m = ensureAppsEntry(old, "shop", "/s/shop");
    expect(m.code).toBe("apps_migrated");
    expect(JSON.parse(m.text as string)).toEqual([panelAppEntry("shop", "/s/shop")]);
    expect(panelAppEntry("shop", "/s/shop")).not.toHaveProperty("env");
    expect(() => ensureAppsEntry("{", "shop", "/s")).toThrow(/not valid JSON/);
  });

  test("scriptRuntimeOf a hand-written pm2 entry", () => {
    expect(scriptRuntimeOf({ execPath: "/p/bin/grun", cwd: "/s/x" })).toBe("grun");
    expect(scriptRuntimeOf({ execPath: "/s/x/app", cwd: "/s/x" })).toBe("native");
    expect(scriptRuntimeOf({ execPath: "/p/bin/php", cwd: "/s/x" })).toBe("other");
    expect(scriptRuntimeOf({ execPath: null, cwd: null })).toBe("other");
  });
});
