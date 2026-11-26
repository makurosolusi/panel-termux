import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeEnvValue,
  ENV_VALUE_MAX,
  encodeEnvLine,
  envValueProblem,
  expandsVariable,
  findEnvLine,
} from "@/shared/env.codec";

const sandbox = mkdtempSync(join(tmpdir(), "env-codec-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

let run = 0;
/** What the real `bun` binary loads for each line `V<i>=<raw>` of a .env file (HOME=/h, nothing else set). */
async function bunLoads(raws: readonly string[]): Promise<(string | undefined)[]> {
  const dir = join(sandbox, `r${run++}`);
  const keys = raws.map((_, i) => `V${i}`);
  await Bun.write(join(dir, ".env"), `${raws.map((r, i) => `${keys[i]}=${r}`).join("\n")}\n`);
  writeFileSync(
    join(dir, "print.ts"),
    `process.stdout.write(JSON.stringify(${JSON.stringify(keys)}.map((k) => process.env[k] ?? null)));`,
  );
  const p = Bun.spawn([process.execPath, "print.ts"], {
    cwd: dir,
    stdout: "pipe",
    env: { PATH: process.env.PATH, HOME: "/h" },
  });
  return JSON.parse(await new Response(p.stdout).text());
}

describe("decodeEnvValue matches Bun's loader", () => {
  // biome-ignore-start lint/suspicious/noTemplateCurlyInString: literal ${…} text is the case under test
  const raws = [
    "plain",
    "'x\\$y'", // \$ literal in single quotes
    '"x\\$y"',
    "x\\$y",
    '"it\'s"',
    '"a\\"b"', // \" is not unescaped
    '"a\\nb"', // \n in double quotes = newline
    "'a\\nb'", // … but not in single quotes
    "a\\nb",
    '"a\\\\nb"', // backslash pair hides n
    '"tab\\tx"',
    "abc # comment",
    "a#b", // # ends an unquoted value even without a space
    "'a#b'",
    '"x#y"',
    "  spaced  ",
    '  "q"  ',
    '"q" # c',
    '"a" b',
    "'x'y",
    "$",
    "a$",
    "p$-q",
    "\\$HOME",
    "a\\\\$HOME",
    '"a\\\\\\$b"',
    "back\\",
    "'a\\\\'",
    "`a\"b'c`",
    "=x",
    "",
    "''",
    'a"b',
    '"unterminated', // last: Bun would let an open quote swallow the following lines
  ];
  // biome-ignore-end lint/suspicious/noTemplateCurlyInString: end of the literal cases
  test("table of raw values", async () => {
    expect(raws.map(decodeEnvValue)).toEqual((await bunLoads(raws)) as string[]);
  });

  test("$NAME is kept literally (Bun expands it) and flagged", async () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${HOME} is the case under test
    const raws = ["p$HOMEq", "'p$HOME'", '"${HOME}x"', "$2b$10$abc"];
    expect(await bunLoads(raws)).toEqual(["p", "p/h", "/hx", ""]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${HOME} is the case under test
    expect(raws.map(decodeEnvValue)).toEqual(["p$HOMEq", "p$HOME", "${HOME}x", "$2b$10$abc"]);
    expect(raws.every(expandsVariable)).toBe(true);
    expect(["\\$HOME", "a$", "$", "p$-q", "plain"].some(expandsVariable)).toBe(false);
  });
});

describe("encodeEnvLine", () => {
  test("bare, single-quoted, or double-quoted when the value holds '", () => {
    expect(encodeEnvLine("A", "plain-value_1.2:3@x")).toBe("A=plain-value_1.2:3@x");
    expect(encodeEnvLine("B", 'has space "q" $HOME')).toBe("B='has space \"q\" \\$HOME'");
    expect(encodeEnvLine("C", "it's $5")).toBe('C="it\'s \\$5"');
  });

  test("every representable value loads back exactly through Bun and decodeEnvValue", async () => {
    const values = [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal ${HOME} is the case under test
      'p@ss "w" $HOME ${HOME} \\ mid',
      "x\\$HOME",
      "a\\nb",
      "#notcomment",
      "=eq= ",
      " lead",
      "$",
      "a\\$",
      "it's",
      "it's $2b$10$abc",
      "$2b$10$N9qo8uLOickgx2ZMRZoMye",
      "tab\there",
      "",
    ];
    const lines = values.map((v, i) => encodeEnvLine(`V${i}`, v));
    const raws = lines.map((l) => l.slice(l.indexOf("=") + 1));
    expect(await bunLoads(raws)).toEqual(values);
    expect(raws.map(decodeEnvValue)).toEqual(values);
  });

  test("refuses what Bun cannot read back", () => {
    expect(() => encodeEnvLine("K", "a\nb")).toThrow(/K: .*multiline/);
  });
});

describe("envValueProblem", () => {
  test.each([
    ["ok", null],
    ["it's", null],
    ['say "hi"', null],
    ["a\\b", null],
    ["a\nb", "multiline"],
    ["a\rb", "multiline"],
    ['it\'s "x"', "quote"],
    ["it's a\\b", "quote"],
    ["end\\", "quote"],
    ["x".repeat(ENV_VALUE_MAX + 1), "too_long"],
  ] as const)("%p → %p", (value, problem) => {
    expect(envValueProblem(value)).toBe(problem);
  });
});

describe("findEnvLine", () => {
  const text = "# PORT=1\nexport PORT = 3001\r\nOTHER=x\nPORT='3002' # last wins\nPORTX=9\n";
  test("raw value of the last defining line", () => {
    expect(findEnvLine(text, "PORT")).toBe("'3002' # last wins");
    expect(decodeEnvValue(findEnvLine(text, "PORT") ?? "")).toBe("3002");
    expect(findEnvLine(text, "OTHER")).toBe("x");
    expect(findEnvLine(text, "MISSING")).toBeNull();
    expect(findEnvLine("A=\n", "A")).toBe("");
  });
});
