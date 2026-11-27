// Guard (PLAN/08 §8, acceptance 8): with an English locale the representative CLI commands print no Indonesian.
// Runs runCli in-process on fake hosts (the source the binary is built from), stdout + stderr together.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeScenarioName } from "@/cli/cli.host";
import { createFakeHost } from "@/cli/cli.host.fake";
import { runCli } from "@/cli/cli.main";
import { createCliOut } from "@/cli/cli.output";
import { indonesianWords } from "./no-indonesian.words";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-no-id-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

/** Runs `argv` with a clean English shell env on a fresh fake host; returns exit code and all output. */
async function run(argv: string[], scenario: FakeScenarioName) {
  const root = join(tmp, String(n++));
  const self = join(tmp, `self-${n}`); // outside the sandbox, like a downloaded binary
  writeFileSync(self, "\x7fELF fake panel\n", { mode: 0o755 }); // test-only
  const host = createFakeHost(scenario, { root, tty: false, answers: [], selfPath: self });
  let text = "";
  const out = createCliOut({ stdout: (t) => (text += t), stderr: (t) => (text += t) });
  // `panel env` stats ./.env and ~/panel/.env from the real process (it takes no cwd and never asks the host):
  // run from an empty sandbox folder with HOME on the sandbox so the developer's own files never show up.
  const cwd = join(tmp, `cwd-${n}`);
  mkdirSync(cwd);
  const [oldCwd, oldHome] = [process.cwd(), process.env.HOME];
  process.chdir(cwd);
  process.env.HOME = host.paths.home;
  try {
    const code = await runCli(argv, {
      out,
      env: { HOME: host.paths.home, LANG: "en_US.UTF-8" },
      host: async () => host,
    });
    return { code, text };
  } finally {
    process.chdir(oldCwd);
    process.env.HOME = oldHome;
  }
}

describe("no Indonesian in English CLI output", () => {
  test.each<[string, string[], FakeScenarioName]>([
    ["-h", ["-h"], "ready"],
    ["init -h", ["init", "-h"], "fresh"],
    ["init --dry-run (fresh phone)", ["init", "--dry-run", "--yes"], "fresh"],
    ["doctor (POCO)", ["doctor"], "poco"],
    ["doctor (fresh phone)", ["doctor"], "fresh"],
    ["env", ["env"], "poco"],
    ["docs", ["docs"], "ready"],
    ["docs packages", ["docs", "packages"], "ready"],
    ["docs paket (old alias)", ["docs", "paket"], "ready"],
    ["docs android", ["docs", "android"], "ready"],
    ["rollback without panel.prev", ["rollback", "--yes"], "ready"],
    ["unknown command", ["frobnicate"], "ready"],
  ])("%s", async (_name, argv, scenario) => {
    const { text } = await run(argv, scenario);
    expect(text.length).toBeGreaterThan(0);
    const hits = text
      .split("\n")
      .flatMap((line) => indonesianWords(line).map((w) => `"${w}" in ${JSON.stringify(line)}`));
    expect(hits).toEqual([]);
  });

  test("control: the same scan flags --lang id output", async () => {
    const { text } = await run(["doctor", "--lang", "id"], "poco");
    expect(indonesianWords(text).length).toBeGreaterThan(0);
  });
});
