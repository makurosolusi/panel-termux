// Shared harness for the `panel init` command tests (cli.init.test.ts, cli.init.run.test.ts): sandboxed fake hosts,
// a write snapshot, runInit with collected output, and recording stub steps.
import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FakeScenarioName } from "@/cli/cli.host";
import { createFakeHost, type FakeHostOptions } from "@/cli/cli.host.fake";
import { createCliOut } from "@/cli/cli.output";
import { runInit } from "@/cli/init.command";
import { defineStep, INIT_STEP_IDS, type InitContext, type InitStep, type InitStepId } from "@/cli/init.types";

/** A fake host as the tests use it. */
export type Host = ReturnType<typeof createFakeHost>;

/** Per test file: a temp root removed after all tests, `fresh()` dirs in it and fake hosts rooted in one. */
export function initSandbox() {
  const tmp = mkdtempSync(join(tmpdir(), "panel-cli-init-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));
  let n = 0;
  const fresh = () => {
    const d = join(tmp, String(n++));
    mkdirSync(d, { recursive: true });
    return d;
  };
  const host = (scenario: FakeScenarioName, opts: FakeHostOptions = {}): Host =>
    createFakeHost(scenario, { root: fresh(), tty: false, answers: [], ...opts });
  return { fresh, host };
}

/** Every path under `dir` with size, mode and mtime: any write shows up. */
export function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const f = join(d, name);
      const s = statSync(f, { throwIfNoEntry: false });
      out.push(`${f} ${s?.size} ${s?.mode} ${s?.mtimeMs}`);
      if (s?.isDirectory()) walk(f);
    }
  };
  walk(dir);
  return out;
}

type Flags = Record<string, string | boolean | string[] | undefined>;
// `lang` = what `--lang en` gives: skips the language question, which cli.init.test.ts covers on its own.
const FLAGS: Flags = { yes: false, "dry-run": false, "skip-verify": false, lang: "en" };

/** runInit with collected output; `steps` default = recording stubs that always plan one action. */
export async function init(h: Host, flags: Flags = {}, steps: readonly InitStep[] = stubs().steps) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = createCliOut({ stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) });
  let exit: number;
  try {
    exit = await runInit({ values: { ...FLAGS, ...flags }, positionals: [] }, { out, host: async () => h }, { steps });
  } catch (e) {
    const err = e as { code?: number; message: string; hint?: string };
    if (typeof err.code !== "number") throw e;
    out.fail(err.message, err.hint);
    exit = err.code;
  }
  return { code: exit, stdout: stdout.join(""), stderr: stderr.join("") };
}

/** Stub steps recording detect/apply; `todo` = ids that still have work (default all); `onApply` per id. */
export function stubs(
  todo: ReadonlySet<InitStepId> = new Set(INIT_STEP_IDS),
  onApply?: (id: InitStepId, ctx: InitContext) => Promise<void>,
) {
  const applied: InitStepId[] = [];
  const detected: InitStepId[] = [];
  const steps = INIT_STEP_IDS.map((id) =>
    defineStep({
      id,
      detect: async () => {
        detected.push(id);
        return todo.has(id);
      },
      plan: (_ctx, needed: boolean) => (needed ? [{ kind: "action" as const, text: `action ${id}` }] : []),
      apply: async (ctx) => {
        applied.push(id);
        await onApply?.(id, ctx);
      },
    }),
  );
  return { steps, applied, detected };
}
