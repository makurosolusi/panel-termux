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

/**
 * Files and packages reached from `entry` by static, non-type imports; `follow(from, target)` also admits a dynamic one.
 */
function closure(entry: string, follow: (from: string, target: string) => boolean = () => false) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop() as string;
    if (files.has(f) || !/\.tsx?$/.test(f)) continue;
    files.add(f);
    for (const i of imports(f)) {
      if (i.typeOnly) continue;
      const target = resolveSpec(f, i.spec);
      if (target === null) {
        if (!i.dynamic) packages.add(i.spec);
      } else if (!i.dynamic || follow(f, target)) queue.push(target);
    }
  }
  return { files, packages };
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
    // main.ts's own dynamic import of the CLI is the CLI path; its import of boot is the serve path
    const { files } = closure(MAIN, (f, target) => f === MAIN && inside(target, CLI));
    const server = [...files].filter((f) => f !== MAIN && inside(f, join(SRC, "server")));
    expect(server.map(rel)).toEqual([]);
    expect(files.has(join(CLI, "cli.main.ts"))).toBe(true);
  });

  test("cli.main loads exactly the five commands, the host and boot on demand", () => {
    const dynamic = imports(join(CLI, "cli.main.ts")).filter((i) => i.dynamic);
    expect(dynamic.map((i) => i.spec).sort()).toEqual(
      [
        "../server/boot",
        "./cli.host",
        "./docs.command",
        "./doctor.command",
        "./env.command",
        "./init.command",
        "./rollback.command",
      ].sort(),
    );
  });

  // -v/-h are the entry path above; env and docs are the other commands that must stay server-free (lab L5).
  for (const name of ["env", "docs"])
    test(`${name}.command.ts never reaches src/server or a package`, () => {
      const { files, packages } = closure(join(CLI, `${name}.command.ts`));
      expect([...files].filter((f) => inside(f, join(SRC, "server"))).map(rel)).toEqual([]);
      expect([...packages].filter((p) => !p.startsWith("node:"))).toEqual([]);
    });

  test("docs.command.ts imports only the embedded docs/cli/*.md and cli.output", () => {
    const f = join(CLI, "docs.command.ts");
    const bad = imports(f).filter(
      (i) => !i.typeOnly && !/^\.\.\/\.\.\/docs\/cli\/[a-z]+\.md$/.test(i.spec) && i.spec !== "./cli.output",
    );
    expect(bad).toEqual([]);
  });

  // doctor may use the integration service (Persiapan card) and the DB layer; rollback opens panel.db with bun:sqlite, never the DB layer.
  const serveOnly = (f: string) =>
    [join(SRC, "server", "boot.ts"), join(SRC, "server", "index.ts"), MAIN].includes(f) ||
    inside(f, join(SRC, "server", "auth")) ||
    (inside(f, join(SRC, "server", "routes")) && f.endsWith(".routes.ts")) ||
    (inside(f, join(SRC, "web")) && !inside(f, join(SRC, "web", "i18n")));
  const HTTP_PACKAGES = ["elysia", "better-auth"];
  for (const [name, extra] of [
    ["doctor", () => false],
    ["rollback", (f: string) => inside(f, join(SRC, "server", "db"))],
  ] as const)
    test(`${name}.command.ts never reaches boot, routes, auth, the SPA or the HTTP stack`, () => {
      const { files, packages } = closure(join(CLI, `${name}.command.ts`));
      expect([...files].filter((f) => serveOnly(f) || extra(f)).map(rel)).toEqual([]);
      expect([...packages].filter((p) => HTTP_PACKAGES.some((h) => p === h || p.startsWith(`${h}/`)))).toEqual([]);
    });

  test("env.schema.ts imports nothing from src/server", () => {
    const f = join(SRC, "shared", "env.schema.ts");
    expect(imports(f).filter((i) => inside(resolveSpec(f, i.spec), join(SRC, "server")))).toEqual([]);
  });

  const ENV_COMMAND = join(CLI, "env.command.ts");
  test("env.command.ts imports only env.schema, env.codec, node:fs, node:os", () => {
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
