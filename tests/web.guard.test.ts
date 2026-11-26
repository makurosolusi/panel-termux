// Static guards over src/web (PLAN/01 §7.4, DECISIONS B30): legacy pieces stay deleted, colours come from the
// semantic tokens, one Toaster, one ticking timer, and the aggregate dictionary stays deleted.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const files = [...new Bun.Glob("src/web/**/*.{ts,tsx,css}").scanSync()].sort();
const source = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const offenders = (re: RegExp, skip: (f: string) => boolean = () => false) =>
  files.filter((f) => !skip(f) && re.test(source.get(f) ?? ""));

const REMOVED = ["src/web/shared/query.state.tsx", "src/web/shared/stat.card.tsx", "src/web/shared/confirm.dialog.tsx"];
/** Raw Tailwind palette colours (`bg-red-500`, `text-emerald-600/80`…) bypass the light/dark status tokens. */
const RAW_PALETTE =
  /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|shadow|decoration|accent|caret|placeholder)-(?:red|green|emerald|amber|yellow|orange|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b|destructive\/10/;

describe("web guard", () => {
  test("the scan sees the SPA sources", () => {
    expect(files).toContain("src/web/layout/app.layout.tsx");
    expect(files.length).toBeGreaterThan(100);
  });

  test("legacy shared modules are gone and nothing imports them", () => {
    for (const f of REMOVED) expect(existsSync(f)).toBe(false);
    expect(
      offenders(
        /shared\/(?:query\.state|stat\.card|confirm\.dialog)["']|LegacyConfirmAction|toneForStatus|LEGACY_TONE/,
      ),
    ).toEqual([]);
  });

  test("no raw Tailwind palette classes", () => {
    for (const c of ["bg-red-500", "text-emerald-600/80", "bg-destructive/10"]) expect(RAW_PALETTE.test(c)).toBe(true);
    expect(RAW_PALETTE.test("bg-danger-subtle text-success")).toBe(false);
    expect(offenders(RAW_PALETTE)).toEqual([]);
  });

  test("exactly one <Toaster, in app.layout.tsx", () => {
    const hits = files.flatMap((f) => (source.get(f)?.match(/<Toaster\b/g) ?? []).map(() => f));
    expect(hits).toEqual(["src/web/layout/app.layout.tsx"]);
  });

  test("setInterval only in now.store.ts", () => {
    expect(offenders(/\bsetInterval\(/)).toEqual(["src/web/components/now.store.ts"]);
  });

  test("the aggregate dictionary is gone and nothing imports it (B30: per-domain dictionaries only)", () => {
    expect(existsSync("src/web/i18n/id.ts")).toBe(false);
    expect(offenders(/from\s+["'](?:@\/web\/i18n|\.)\/id["']/)).toEqual([]);
  });
});
