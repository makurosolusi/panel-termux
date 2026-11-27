import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// PLAN/07 §7.3: one import direction (cli → server/shared, never back) and a CLI path that never reaches the server
// bundle (static source check; lab L5 proves the same on the real build).
const ROOT = join(import.meta.dir, "..");
const SRC = join(ROOT, "src");
const rel = (f: string) => relative(ROOT, f);

type Imp = { spec: string; dynamic: boolean; typeOnly: boolean };
const STATIC = /^\s*(import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function imports(file: string): Imp[] {
  const text = readFileSync(file, "utf8");
  const out: Imp[] = [];
  for (const m of text.matchAll(STATIC)) out.push({ spec: m[3] as string, dynamic: false, typeOnly: !!m[2] });
  for (const m of text.matchAll(DYNAMIC)) out.push({ spec: m[1] as string, dynamic: true, typeOnly: false });
  return out;
}

/** Absolute source file of a relative or `@/` specifier; null for packages and node: builtins. */
function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? join(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")])
    if (existsSync(c) && c.match(/\.(tsx?|json)$/)) return c;
  return base;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

const MAIN = join(SRC, "server", "main.ts");
const CLI = join(SRC, "cli");
const inside = (f: string | null, dir: string) => f?.startsWith(`${dir}/`) === true;

describe("CLI import rules", () => {
  test("nothing in src/server (except main.ts) or src/web imports src/cli", () => {
    const bad = [...walk(join(SRC, "server")), ...walk(join(SRC, "web"))]
      .filter((f) => f !== MAIN)
      .flatMap((f) =>
        imports(f)
          .filter((i) => inside(resolveSpec(f, i.spec), CLI))
          .map((i) => `${rel(f)} → ${i.spec}`),
      );
    expect(bad).toEqual([]);
  });

  test("main.ts statically imports only the pure env schema; boot and the CLI load dynamically", () => {
    const all = imports(MAIN);
    expect(all.filter((i) => !i.dynamic).map((i) => i.spec)).toEqual(["../shared/env.schema"]);
    expect(all.filter((i) => i.dynamic).map((i) => i.spec)).toEqual(["./boot", "../cli/cli.main"]);
  });

  test("the CLI entry path (static, non-type imports from main.ts) never reaches src/server", () => {
    const seen = new Set<string>();
    const queue = [MAIN];
    while (queue.length) {
      const f = queue.pop() as string;
      if (seen.has(f) || !f.endsWith(".ts")) continue;
      seen.add(f);
      for (const i of imports(f)) {
        if (i.typeOnly) continue;
        const target = resolveSpec(f, i.spec);
        // main.ts's own dynamic import of the CLI is the CLI path; its import of boot is the serve path
        if (target && (!i.dynamic || (f === MAIN && inside(target, CLI)))) queue.push(target);
      }
    }
    const server = [...seen].filter((f) => f !== MAIN && inside(f, join(SRC, "server")));
    expect(server.map(rel)).toEqual([]);
    expect(seen.has(join(CLI, "cli.main.ts"))).toBe(true);
  });

  test("env.schema.ts imports nothing from src/server", () => {
    const f = join(SRC, "shared", "env.schema.ts");
    expect(imports(f).filter((i) => inside(resolveSpec(f, i.spec), join(SRC, "server")))).toEqual([]);
  });

  const ENV_COMMAND = join(CLI, "env.command.ts");
  test.skipIf(!existsSync(ENV_COMMAND))("env.command.ts imports only env.schema, env.codec, node:fs, node:os", () => {
    const allowed = new Set([join(SRC, "shared", "env.schema.ts"), join(SRC, "shared", "env.codec.ts")]);
    const bad = imports(ENV_COMMAND).filter((i) => {
      if (i.typeOnly) return false;
      const t = resolveSpec(ENV_COMMAND, i.spec);
      return t === null ? !["node:fs", "node:os"].includes(i.spec) : !allowed.has(t);
    });
    expect(bad).toEqual([]);
  });

  test("no src/cli file uses selectSystem (D1, D15: it picks fake without sv and logs to stdout)", () => {
    const bad = walk(CLI).filter((f) => /\bselectSystem\b/.test(readFileSync(f, "utf8")));
    expect(bad.map(rel)).toEqual([]);
  });
});
