import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeArgv, runCli, versionLine } from "@/cli/cli.main";
import { createCliOut } from "@/cli/cli.output";
import { entryRoute } from "@/server/main";
import pkg from "../package.json" with { type: "json" };

const ROOT = join(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "panel-cli-args-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function cli(argv: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const host = () => Promise.reject(new Error("host must not be asked")); // test-only
  const code = await runCli(argv, {
    out: createCliOut({ stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) }),
    host,
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

// Child bun with a preload that prefixes boot.ts with a stderr marker: proves which argv evaluate the server.
const preload = join(tmp, "boot-marker.ts");
writeFileSync(
  preload,
  `Bun.plugin({ name: "boot-marker", setup(b) {
  b.onLoad({ filter: /src[\\\\/]server[\\\\/]boot\\.ts$/ }, async (a) => ({
    contents: 'process.stderr.write("BOOT_EVAL\\\\n");\\n' + (await Bun.file(a.path).text()), loader: "ts" }));
} });\n`,
);
function child(script: string) {
  const p = Bun.spawnSync(["bun", "--preload", preload, "-e", script], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", HOME: tmp },
    stdin: "ignore",
  });
  return { code: p.exitCode, stderr: p.stderr.toString(), stdout: p.stdout.toString() };
}
const runCliChild = (argv: string[]) =>
  child(
    `const { runCli } = await import("./src/cli/cli.main.ts"); process.exitCode = await runCli(${JSON.stringify(argv)});`,
  );

describe("entryRoute (K2)", () => {
  test("no args without a TTY serves (runit), on a TTY is the CLI", () => {
    expect(entryRoute([], false)).toBe("serve");
    expect(entryRoute([], true)).toBe("cli");
  });
  test("only exactly `serve` serves; anything else never does", () => {
    expect(entryRoute(["serve"], true)).toBe("serve");
    expect(entryRoute(["serve"], false)).toBe("serve");
    expect(entryRoute(["serve", "--x"], false)).toBe("cli");
    expect(entryRoute(["--bogus"], false)).toBe("cli");
    expect(entryRoute(["-v"], false)).toBe("cli");
  });
});

describe("runCli", () => {
  test("bare panel on a terminal: help naming `panel serve` on stderr, exit 2", async () => {
    const r = await cli([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Pemakaian");
    expect(r.stderr).toContain("panel serve");
    expect(r.stdout).toBe("");
  });

  test("-h, --help, --h and help print the same help on stdout, exit 0", async () => {
    const outs = await Promise.all([["-h"], ["--help"], ["--h"], ["help"]].map(cli));
    for (const r of outs) {
      expect(r.code).toBe(0);
      expect(r.stdout).toBe(outs[0]?.stdout as string);
      expect(r.stderr).toBe("");
    }
    expect(outs[0]?.stdout).toContain("panel serve");
  });

  test("-v, --version, --v print the package.json version line", async () => {
    for (const argv of [["-v"], ["--version"], ["--v"]]) {
      const r = await cli(argv);
      expect(r.code).toBe(0);
      expect(r.stdout).toBe(`${versionLine()}\n`);
      expect(r.stdout).toStartWith(`panel-termux ${pkg.version} (${process.platform}-${process.arch}, bun `);
    }
  });

  test("-v --json is a usage error (m16)", async () => {
    const r = await cli(["-v", "--json"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Opsi tidak dikenal: --json");
  });

  test("unknown flags and commands exit 2", async () => {
    expect((await cli(["--bogus"])).code).toBe(2);
    expect((await cli(["doctor", "--bogus"])).code).toBe(2);
    expect((await cli(["serve", "--x"])).code).toBe(2);
    expect((await cli(["serve", "x"])).code).toBe(2);
    expect((await cli(["docs", "a", "b"])).code).toBe(2);
    const r = await cli(["frobnicate"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Perintah tidak dikenal: frobnicate");
    expect(r.stderr).not.toContain("install.sh");
  });

  test("init and upgrade are not commands in 0.5.0 and point at install.sh", async () => {
    for (const name of ["init", "upgrade"]) {
      const r = await cli([name]);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("install.sh");
    }
  });

  test("<command> --help prints that command's help", async () => {
    for (const name of ["serve", "doctor", "docs", "env", "rollback"]) {
      const r = await cli([name, "--help"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain(`panel ${name}`);
    }
    expect((await cli(["help", "rollback"])).stdout).toContain("--yes");
  });

  test("aliases normalize before parsing (K3)", () => {
    expect(normalizeArgv(["--env", "--full"])).toEqual(["env", "--full"]);
    expect(normalizeArgv(["--v"])).toEqual(["--version"]);
    expect(normalizeArgv(["doctor", "--h"])).toEqual(["doctor", "--help"]);
    expect(normalizeArgv(["help", "doctor"])).toEqual(["doctor", "--help"]);
    expect(normalizeArgv(["help"])).toEqual(["--help"]);
  });
});

describe("CLI never evaluates the server (spy via boot.ts marker)", () => {
  test("positive control: importing boot prints the marker", () => {
    expect(child(`await import("./src/server/boot.ts");`).stderr).toContain("BOOT_EVAL");
  });

  test("bare panel, -v, --help, unknown flag: no boot", () => {
    for (const [argv, code] of [
      [[], 2],
      [["-v"], 0],
      [["--help"], 0],
      [["--bogus"], 2],
      [["doctor", "--help"], 0],
    ] as const) {
      const r = runCliChild([...argv]);
      expect(r.code).toBe(code);
      expect(r.stderr).not.toContain("BOOT_EVAL");
    }
  });
});
