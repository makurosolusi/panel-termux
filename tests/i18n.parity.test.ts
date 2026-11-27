// Key parity between every English dictionary and its Indonesian overlay (PLAN/08 §4.2, DECISIONS E8): what the
// type `Messages<typeof t*>` cannot see — array lengths, function arity, empty strings, and that every function leaf
// really returns text — plus the import rules that keep dictionaries out of the bootstrap.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import idPack from "@/web/i18n/id.pack";

const I18N = "src/web/i18n";
const pascal = (domain: string) => domain.replace(/(^|[.-])([a-z])/g, (_m, _sep, c: string) => c.toUpperCase());
/** Sample arguments tried in turn for every parameter until a call returns. */
const SAMPLES: unknown[] = [1, "x", new Date(0), ["x"]];

/** English dictionaries by domain, found by the naming contract: domain `site-detail` ↔ export `tSiteDetail`. */
async function englishByDomain(): Promise<Map<string, unknown>> {
  const byExport = new Map(Object.keys(idPack).map((d) => [`t${pascal(d)}`, d]));
  const found = new Map<string, unknown>();
  // problem.copy.en.ts lives in src/shared because the server speaks the same words (domain "problem").
  const files = [...new Bun.Glob("en.*.ts").scanSync(I18N)].map((f) => `@/web/i18n/${f.slice(0, -3)}`);
  for (const file of [...files, "@/shared/problem.copy.en"]) {
    const mod: Record<string, unknown> = await import(file);
    for (const [name, value] of Object.entries(mod)) {
      if (!/^t[A-Z]/.test(name) || typeof value !== "object") continue;
      const domain = byExport.get(name);
      if (!domain) throw new Error(`${file}: dictionary ${name} has no entry in id.pack.ts`);
      found.set(domain, value);
    }
  }
  return found;
}

const call = (fn: (...a: unknown[]) => unknown): unknown => {
  for (const sample of SAMPLES) {
    try {
      return fn(...Array.from({ length: Math.max(fn.length, 1) }, () => sample));
    } catch {
      // this sample does not fit the parameter types: try the next one
    }
  }
  return undefined;
};

/** Every difference between `en` and `id` at `path`, as readable lines. */
function diff(en: unknown, id: unknown, path: string, out: string[] = []): string[] {
  if (typeof en !== typeof id || Array.isArray(en) !== Array.isArray(id)) {
    out.push(`${path}: en ${typeof en}, id ${typeof id}`);
    return out;
  }
  if (typeof en === "string") {
    if (!en || !id) out.push(`${path}: empty string`);
  } else if (typeof en === "function" && typeof id === "function") {
    if (en.length !== id.length) out.push(`${path}: en takes ${en.length} parameter(s), id ${id.length}`);
    for (const [lang, fn] of [
      ["en", en],
      ["id", id],
    ] as const) {
      const text = call(fn as (...a: unknown[]) => unknown);
      if (typeof text !== "string" || !text) out.push(`${path} (${lang}): returned ${JSON.stringify(text)}`);
    }
  } else if (Array.isArray(en) && Array.isArray(id)) {
    if (en.length !== id.length) out.push(`${path}: en has ${en.length} item(s), id ${id.length}`);
    for (const [i, v] of en.slice(0, id.length).entries()) diff(v, id[i], `${path}[${i}]`, out);
  } else if (en && id && typeof en === "object") {
    const a = Object.keys(en).sort();
    const b = Object.keys(id as object).sort();
    for (const k of a.filter((k) => !b.includes(k))) out.push(`${path}.${k}: missing in id`);
    for (const k of b.filter((k) => !a.includes(k))) out.push(`${path}.${k}: only in id`);
    for (const k of a.filter((k) => b.includes(k)))
      diff((en as Record<string, unknown>)[k], (id as Record<string, unknown>)[k], `${path}.${k}`, out);
  }
  return out;
}

describe("i18n parity", () => {
  test("every pack domain has exactly one English dictionary and vice versa", async () => {
    const en = await englishByDomain();
    expect([...en.keys()].sort()).toEqual(Object.keys(idPack).sort());
    expect(en.size).toBeGreaterThanOrEqual(25);
  });

  test("same keys, leaf types, array lengths and arity; function leaves return non-empty text", async () => {
    const en = await englishByDomain();
    const problems = [...en].flatMap(([d, dict]) => diff(dict, (idPack as Record<string, unknown>)[d], d));
    expect(problems).toEqual([]);
  });

  test("the detector catches a drifted overlay", () => {
    const en = { a: "A", list: ["1", "2"], fn: (n: number) => `${n}`, o: { b: "B" } };
    const id = { a: "", list: ["1"], fn: () => "", o: { c: "C" } };
    expect(diff(en, id, "x")).toEqual([
      "x.a: empty string",
      "x.fn: en takes 1 parameter(s), id 0",
      'x.fn (id): returned ""',
      "x.list: en has 2 item(s), id 1",
      "x.o.b: missing in id",
      "x.o.c: only in id",
    ]);
  });
});

describe("i18n import rules", () => {
  const RUNTIME_DICTIONARY = /^import\s+(?!type\b)[^;]*from\s+["'][^"']*i18n\/(?:en|id)\.[^"']+["']/m;

  test.each(["src/shared/i18n.ts", "src/shared/locale.ts", "src/web/main.tsx", "src/web/i18n/locale.detect.ts"])(
    "%s imports no dictionary at runtime",
    (file) => {
      const src = readFileSync(file, "utf8");
      expect(RUNTIME_DICTIONARY.test(src)).toBe(false);
      expect(/import\(\s*["'][^"']*i18n\/en\./.test(src)).toBe(false);
    },
  );

  test("only id.pack.ts (and id.* nesting) imports id.*; the bootstrap only loads the pack lazily", () => {
    const allowed = (f: string) => /^src\/web\/i18n\/id\./.test(f) || /^tests\/i18n\.[^/]+\.test\.ts$/.test(f);
    const importsId = /(?:from\s+|import\(\s*)["'](?:[^"']*i18n\/|\.\/)id\.[^"']+["']/;
    const offenders = ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "scripts/**/*.ts"]
      .flatMap((g) => [...new Bun.Glob(g).scanSync(".")])
      .filter((f) => !allowed(f) && importsId.test(readFileSync(f, "utf8")))
      .sort();
    // main.tsx loads the pack lazily; the CLI doctor reads idSiteSetup directly (PLAN/08 §6: the CLI has no overlay).
    expect(offenders).toEqual(["src/cli/doctor.command.ts", "src/web/main.tsx"]);
    expect(readFileSync("src/web/main.tsx", "utf8")).toContain('await import("@/web/i18n/id.pack")');
  });

  test("id.* files import English only as types, and nothing else that could evaluate a dictionary", () => {
    const bad: string[] = [];
    for (const file of new Bun.Glob("id.*.ts").scanSync(I18N)) {
      if (file === "id.pack.ts") continue;
      const src = readFileSync(`${I18N}/${file}`, "utf8");
      for (const m of src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)) {
        const [, isType, spec = ""] = m;
        const ok = isType ? true : /^\.\/id\./.test(spec) || /^@\/shared\//.test(spec);
        if (!ok || (!isType && /en\./.test(spec))) bad.push(`${file}: ${m[0].replace(/\s+/g, " ")}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("the rule itself sees a runtime import and ignores a type import", () => {
    expect(RUNTIME_DICTIONARY.test('import { tShell } from "@/web/i18n/en.shell";')).toBe(true);
    expect(RUNTIME_DICTIONARY.test('import type { tShell } from "./en.shell";')).toBe(false);
  });
});
