// Service steps, continued from cli.init.services.test.ts (split for file size): boot (step 9).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeScenarioName, probePaths } from "@/cli/cli.host";
import { createFakeHost, type FakeHost } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { BOOT_SCRIPT, bootStep } from "@/cli/init.boot";
import { parseInitArgs } from "@/cli/init.command";
import type { InitContext, InitMode, InitStep, ModeDecision } from "@/cli/init.types";

const tmp = mkdtempSync(join(tmpdir(), "panel-cli-svc2-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
function host(scenario: FakeScenarioName): FakeHost {
  const root = join(tmp, String(n++));
  mkdirSync(root, { recursive: true });
  const h = createFakeHost(scenario, { root, tty: false, answers: [] });
  h.system();
  return h;
}
function ctxOf(h: FakeHost, mode: InitMode): InitContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    host: h,
    args: parseInitArgs({ yes: true }),
    mode,
    decision: { mode } as ModeDecision,
    out: createCliOut({ stdout: (t) => lines.push(t), stderr: (t) => lines.push(t) }),
    tty: false,
    prompt: h.tty,
    state: { changed: [], manual: [] },
    confirmRisky: async () => true,
    guardSigint: (fn) => fn(),
    resumeCommand: () => "panel init",
    lines,
  };
}
async function planOf(step: InitStep, ctx: InitContext) {
  const s = await step.detect(ctx);
  return { s, lines: step.plan(ctx, s) };
}
async function run(step: InitStep, ctx: InitContext) {
  const { s, lines } = await planOf(step, ctx);
  expect(lines.filter((l) => l.kind === "action").length).toBeGreaterThan(0);
  await step.apply(ctx, s);
}
const argvs = (h: FakeHost) => h.records.map((r) => r.argv.join(" "));

describe("boot (step 9)", () => {
  test("fresh: script with SVDIR+LOGDIR, wake lock now, battery + Termux:Boot notes", async () => {
    const h = host("fresh"); // fresh has no Termux:Boot app
    const ctx = ctxOf(h, "fresh");
    const { lines } = await planOf(bootStep, ctx);
    expect(lines.map((l) => l.kind)).toEqual(["action", "warning"]);
    await run(bootStep, ctx);
    const file = join(probePaths(h.paths).bootDir, BOOT_SCRIPT);
    const text = readFileSync(file, "utf8");
    expect(text).toContain(`export SVDIR="${h.paths.svdir}" LOGDIR="${h.paths.logdir}"`);
    expect(text).toContain(`exec ${h.paths.prefix}/bin/service-daemon start`);
    expect(statSync(file).mode & 0o777).toBe(0o755);
    expect(argvs(h)).toContain("termux-wake-lock");
    expect(ctx.lines.join("")).toContain("pilih Izinkan");
    expect(ctx.state.manual).toHaveLength(2);
  });

  test("repair: no battery note; a boot script that already starts the services → nothing", async () => {
    const ctx = ctxOf(host("fresh"), "repair");
    await run(bootStep, ctx);
    expect(ctx.state.manual.some((m) => m.includes("baterai"))).toBe(false);
    expect((await planOf(bootStep, ctxOf(host("poco"), "repair"))).lines).toEqual([]);
  });
});
