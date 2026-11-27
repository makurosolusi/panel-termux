import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeArgv } from "@/cli/cli.main";
import { ENV_VARS, renderEnvTemplate } from "@/shared/env.schema";

// PLAN/07 K18, §6.2. Runs envCommand in a child so cwd, HOME and the shell redirection of stdout are real.
const ROOT = join(import.meta.dir, "..");
const RUNNER = `
import { envCommand } from ${JSON.stringify(join(ROOT, "src/cli/env.command.ts"))};
import { createCliOut } from ${JSON.stringify(join(ROOT, "src/cli/cli.output.ts"))};
const full = process.argv.includes("--full");
process.exitCode = await envCommand({ values: { full }, positionals: [] }, { out: createCliOut(), host: () => { throw new Error("env must not ask for the host"); } });
`;
const T = mkdtempSync(join(tmpdir(), "panel-cli-env-"));
const runnerFile = join(T, "runner.ts");
writeFileSync(runnerFile, RUNNER);
afterAll(() => rmSync(T, { recursive: true, force: true }));

let n = 0;
/** Fresh cwd + HOME; `redirect` is the shell redirection of stdout (default: captured pipe). */
function run(opts: { full?: boolean; redirect?: string; cwdEnv?: string; homeEnv?: string } = {}) {
  const dir = join(T, `case-${n++}`);
  const cwd = join(dir, "work");
  const home = join(dir, "home");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(home, "panel"), { recursive: true });
  if (opts.cwdEnv !== undefined) writeFileSync(join(cwd, ".env"), opts.cwdEnv);
  if (opts.homeEnv !== undefined) writeFileSync(join(home, "panel", ".env"), opts.homeEnv);
  const cmd = `exec bun ${JSON.stringify(runnerFile)}${opts.full ? " --full" : ""} ${opts.redirect ?? ""}`;
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd, env: { PATH: process.env.PATH, HOME: home } });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString(), cwd, home };
}

/** KEY=value lines of a dotenv text (comments skipped). */
const keys = (text: string) =>
  text
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => l.split("=")[0]);

// test-only sentinel standing in for a real secret in an existing .env
const SENTINEL = "test-only-sentinel-9f3a";
const FILLED = `APP_BASE_URL=https://fake.test\nGOOGLE_CLIENT_SECRET=${SENTINEL}\n`;

describe("panel env template", () => {
  test("minimal = exactly the required keys in ENV_VARS order, all empty, stderr empty without .env", () => {
    const r = run();
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(renderEnvTemplate({ full: false }));
    expect(keys(r.stdout)).toEqual(ENV_VARS.filter((v) => v.required).map((v) => v.name));
    expect(r.stdout.split("\n").filter((l) => /^[A-Z_]+=/.test(l) && !l.endsWith("="))).toEqual([]);
  });

  test("--full adds every optional key commented out at its default", () => {
    const r = run({ full: true });
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(renderEnvTemplate({ full: true }));
    for (const v of ENV_VARS.filter((x) => !x.required)) expect(r.stdout).toContain(`\n# ${v.name}=${v.default}\n`);
  });

  test("no example for secrets and no placeholder is printed", () => {
    const text = renderEnvTemplate({ full: true });
    expect(text).not.toContain("GOOGLE_CLIENT_SECRET. Contoh");
    for (const v of ENV_VARS) for (const p of "placeholders" in v ? v.placeholders : []) expect(text).not.toContain(p);
  });

  test(".env.example is renderEnvTemplate({ full: true }) byte for byte", () => {
    expect(readFileSync(join(ROOT, ".env.example"), "utf8")).toBe(renderEnvTemplate({ full: true }));
  });

  test("--env is normalized to env", () => {
    expect(normalizeArgv(["--env", "--full"])).toEqual(["env", "--full"]);
  });
});

describe("panel env next to an existing .env", () => {
  test("./.env and ~/panel/.env with values: noted on stderr, values never printed, files unchanged", () => {
    const r = run({ cwdEnv: FILLED, homeEnv: FILLED, redirect: "> out.env" });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("./.env sudah ada");
    expect(r.stderr).toContain("~/panel/.env sudah ada");
    expect(r.stderr).toContain("noclobber");
    const printed = readFileSync(join(r.cwd, "out.env"), "utf8");
    expect(printed).toBe(renderEnvTemplate({ full: false }));
    expect(printed + r.stderr).not.toContain(SENTINEL);
    expect(readFileSync(join(r.cwd, ".env"), "utf8")).toBe(FILLED);
    expect(readFileSync(join(r.home, "panel", ".env"), "utf8")).toBe(FILLED);
  });

  test("stdout = ./.env truncated by the shell: template written, warned, exit 0", () => {
    const r = run({ cwdEnv: FILLED, redirect: "> .env" });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain("dikosongkan oleh shell");
    expect(r.stderr).not.toContain("sudah ada");
    expect(readFileSync(join(r.cwd, ".env"), "utf8")).toBe(renderEnvTemplate({ full: false }));
  });

  test("stdout = ~/panel/.env with data (append): nothing written, exit 1 (m10)", () => {
    const r = run({ homeEnv: FILLED, redirect: '>> "$HOME/panel/.env"' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("tidak menambah ke .env yang berisi");
    expect(r.stderr).not.toContain(SENTINEL);
    expect(readFileSync(join(r.home, "panel", ".env"), "utf8")).toBe(FILLED);
  });
});
