// Guard (PLAN/08 §8, acceptance 1): nothing Indonesian in the English defaults — every leaf of every English
// dictionary, and the string literals of every chunk the built web app serves in English (all but the id pack).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";
import { indonesianWords } from "./no-indonesian.words";

/**
 * Indonesian literals the English build ships on purpose, each read as data and never shown in English:
 * - "ringkasan", "belum-dikelola": old site-detail anchors, still accepted and redirected (site.legacy-anchor.tsx, E14)
 * - "Perangkat tidak dikenal": the old stored audit device label, recognised to render in English (device.label.ts, E10)
 * - "mnt", "dtk": Indonesian duration units, picked at runtime only for lang=id (shared/format.number.ts)
 */
const BUILD_ALLOW = new Set(["ringkasan", "belum-dikelola", "Perangkat tidak dikenal", "mnt", "dtk"]);

const SAMPLES: unknown[] = [1, "x", new Date(0), ["x"]];

/** Every text a dictionary can produce, as `path: text` (function leaves called with each sample that fits). */
function leaves(value: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (typeof value === "string") out.push([path, value]);
  else if (typeof value === "function") {
    for (const sample of SAMPLES) {
      try {
        const text = value(...Array.from({ length: Math.max(value.length, 1) }, () => sample));
        if (typeof text === "string") out.push([`${path}(${String(sample)})`, text]);
      } catch {
        // this sample does not fit the parameter types: the other samples cover the leaf
      }
    }
  } else if (Array.isArray(value)) for (const [i, v] of value.entries()) leaves(v, `${path}[${i}]`, out);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) leaves(v, `${path}.${k}`, out);
  return out;
}

describe("no Indonesian in English dictionaries", () => {
  const files = [...new Bun.Glob("en.*.ts").scanSync("src/web/i18n")].map((f) => `@/web/i18n/${f.slice(0, -3)}`);

  test.each([...files, "@/shared/problem.copy.en"])("%s", async (file) => {
    const mod: Record<string, unknown> = await import(file);
    const dicts = Object.entries(mod).filter(([name, v]) => /^t[A-Z]/.test(name) && typeof v === "object");
    expect(dicts.length).toBeGreaterThan(0);
    const hits = dicts
      .flatMap(([name, dict]) => leaves(dict, name))
      .flatMap(([path, text]) => indonesianWords(text).map((w) => `${path}: "${w}" in ${JSON.stringify(text)}`));
    expect(hits).toEqual([]);
  });
});

describe("no Indonesian in the built web app (English chunks)", () => {
  let root = "";
  let chunks: { path: string; text: string }[] = [];

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "panel-no-id-"));
    const result = await Bun.build({
      entrypoints: ["./src/web/index.html"],
      outdir: root,
      splitting: true,
      // identifiers stay readable: minified names (`ini`, `dan`, `itu`) would collide with the stopwords
      minify: { whitespace: true, syntax: true, identifiers: false },
      metafile: true,
      plugins: [tailwind],
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
    });
    if (!result.success || !result.metafile) throw new Error(`web build failed: ${result.logs.join("\n")}`);
    const raw: unknown = result.metafile; // object in Bun ≥ 1.4.5, JSON string before
    const outputs: Record<string, { entryPoint?: string }> = (typeof raw === "string" ? JSON.parse(raw) : raw).outputs;
    // Only the id pack may carry Indonesian; it is fetched for lang=id alone (i18n.boot proves en never loads it).
    chunks = Object.entries(outputs)
      .filter(([p, o]) => /\.(js|html)$/.test(p) && o.entryPoint !== "src/web/i18n/id.pack.ts")
      .map(([p]) => ({ path: p.replace(/^.*\//, ""), text: readFileSync(join(root, p.replace(/^.*\//, "")), "utf8") }));
  }, 120_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /** String literals of minified JS ("…", '…', `…`); minified identifiers like `ini` are code, not copy. */
  const literals = (js: string) =>
    [...js.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)].map(
      (m) => m[1] ?? m[2] ?? m[3] ?? "",
    );

  test("the scan sees the English copy and the guard fires on Indonesian", () => {
    expect(chunks.some((c) => c.path.endsWith(".html"))).toBe(true);
    const all = chunks.flatMap((c) => literals(c.text));
    expect(all).toContain("Sign out");
    expect(indonesianWords("Gagal menyimpan, coba lagi dari HP")).toEqual(["gagal", "coba", "lagi", "dari", "HP"]);
    expect(indonesianWords("/mnt/sdcard wake-lock config.ini, 5 hp")).toEqual([]);
  });

  test("no Indonesian stopword in any English chunk's string literals or HTML text", () => {
    const hits = chunks.flatMap(({ path, text }) => {
      const parts = path.endsWith(".html") ? [text.replace(/<[^>]*>/g, " ")] : literals(text);
      // ponytail: regex literal scan, not a JS parser; a regex/template edge case can misalign quotes (then a hit
      // shows code, not copy) — switch to a real tokenizer if that ever happens.
      return parts
        .filter((s) => !BUILD_ALLOW.has(s))
        .flatMap((s) => indonesianWords(s).map((w) => `${path}: "${w}" in ${JSON.stringify(s.slice(0, 160))}`));
    });
    expect(hits).toEqual([]);
  });
});
