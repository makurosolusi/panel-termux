// panel init step 7, pm2 without pm2-runtime (M2): our setup goes in only when pm2-runtime is installed or step 2
// (which installs it) runs in this mode/TTY; otherwise only a warning, nothing written.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probePaths } from "@/cli/cli.host";
import { createFakeHost } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { parseInitArgs } from "@/cli/init.command";
import { createPm2Step } from "@/cli/init.pm2";
import type { InitContext, InitMode, ModeDecision } from "@/cli/init.types";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-pm2-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const pm2 = createPm2Step({ daemonMs: 60, svMs: 60, healthMs: 60, pollMs: 5 });

function ctxOf(mode: InitMode, tty: boolean, runtime: boolean): InitContext {
  const root = join(tmp, String(n++));
  mkdirSync(root, { recursive: true });
  const execAnswers = (tool: string) => (tool.endsWith("sv") ? { code: 0, stdout: "", stderr: "" } : undefined);
  const host = createFakeHost("fresh", { root, tty, answers: [], execAnswers }); // fresh: no pm2 setup, no node
  if (runtime) {
    const f = probePaths(host.paths).pm2Runtime;
    mkdirSync(join(f, ".."), { recursive: true });
    writeFileSync(f, "#!/usr/bin/env node\n"); // test-only
  }
  return {
    host,
    args: parseInitArgs({ yes: true }),
    mode,
    decision: { mode } as ModeDecision,
    out: createCliOut({ stdout: () => {}, stderr: () => {} }),
    tty,
    prompt: host.tty,
    state: { changed: [], manual: [] },
    confirmRisky: async () => true,
    guardSigint: (fn) => fn(),
    resumeCommand: () => "panel init",
  };
}
const planOf = async (ctx: InitContext) => pm2.plan(ctx, await pm2.detect(ctx));
const kinds = (lines: { kind: string }[]) => lines.map((l) => l.kind);

describe("pm2 without pm2-runtime (M2)", () => {
  test("repair without TTY (step 2 does not run): warning 'pm2 belum terpasang', no action, nothing written", async () => {
    const ctx = ctxOf("repair", false, false);
    const lines = await planOf(ctx);
    expect(lines).toEqual([
      { kind: "warning", text: "pm2 is not installed yet", hint: "run panel init again in a terminal" },
    ]);
    expect(existsSync(join(ctx.host.paths.home, "sites"))).toBe(false);
    expect(existsSync(join(ctx.host.paths.svdir, "pm2"))).toBe(false);
  });

  test("step 2 runs first (fresh, or repair with TTY) → planned; pm2-runtime already there → planned", async () => {
    for (const [mode, tty, runtime] of [
      ["fresh", false, false],
      ["repair", true, false],
      ["repair", false, true],
    ] as const)
      expect(kinds(await planOf(ctxOf(mode, tty, runtime)))).toEqual(["action"]);
  });

  test("hand-made ecosystem with the v1 panel block → 'older version' warning, not 'does not load'", async () => {
    const ctx = ctxOf("repair", false, true);
    const sites = join(ctx.host.paths.home, "sites");
    mkdirSync(sites, { recursive: true });
    const v1 = readFileSync(join(import.meta.dir, "fixtures", "ecosystem", "marked-v1.config.js"), "utf8");
    writeFileSync(join(sites, "ecosystem.config.js"), v1);
    const texts = (await planOf(ctx)).map((l) => (l as { text: string }).text);
    expect(texts).toContain("The panel block in ecosystem.config.js is from an older version");
    expect(texts).not.toContain("ecosystem.config.js does not load the sites made by the panel yet (apps.json)");
  });

  test("with pm2-runtime, repair without TTY writes the setup and starts it", async () => {
    const ctx = ctxOf("repair", false, true);
    await pm2.apply(ctx, await pm2.detect(ctx));
    expect(existsSync(join(ctx.host.paths.home, "sites", "ecosystem.config.js"))).toBe(true);
    expect(existsSync(join(ctx.host.paths.svdir, "pm2", "run"))).toBe(true);
    expect((ctx.host as ReturnType<typeof createFakeHost>).records.map((r) => r.argv.join(" "))).toContain("sv up pm2");
  });
});
