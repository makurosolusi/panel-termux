import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runCommand, setAppRuntime } from "@/server/deploy/deploy.steps";
import { BinaryError, detectRuntime } from "@/server/deploy/elf.runtime";
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

describe("apps.json runtime entry", () => {
  const apps = `${JSON.stringify([
    { name: "shop", cwd: "/s/shop", script: "./app", interpreter: "none", env: { PORT: "3100" } },
    { name: "other", script: "x" },
  ])}\n`;

  test("grun sets script + args, native removes args; other apps and fields kept", () => {
    const g = JSON.parse(setAppRuntime(apps, "shop", "grun"));
    expect(g[0]).toEqual({ ...JSON.parse(apps)[0], ...runCommand("grun") });
    expect(g[0].args).toEqual(["./app"]);
    expect(g[0].script).toMatch(/\/bin\/grun$/);
    expect(g[1]).toEqual({ name: "other", script: "x" });
    const n = JSON.parse(setAppRuntime(JSON.stringify(g), "shop", "native"));
    expect(n[0]).toEqual(JSON.parse(apps)[0]);
  });

  test("missing entry throws", () => {
    expect(() => setAppRuntime(apps, "nope", "native")).toThrow(/no app named nope/);
  });
});
