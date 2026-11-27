// Re-runnable consumer rename for PLAN/08 §4.1 / DECISIONS E7: imports of `src/web/i18n/id.<domain>` become
// `en.<domain>` and the dictionary identifiers `id<Domain>` become `t<Domain>` (value and type positions alike).
// Usage: `bun scripts/codemod-i18n.ts` (idempotent; run again after a rebase instead of resolving conflicts).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const ROOT = process.cwd();
const I18N = "src/web/i18n";
/** Files that must keep importing the Indonesian modules: the dictionaries themselves, the pack, and tests that
 * compare English with Indonesian on purpose. */
const KEEP = [/^src\/web\/i18n\/(id|en)\.[^/]+\.ts$/, /^tests\/i18n\.[^/]+\.test\.ts$/, /^scripts\/codemod-i18n\.ts$/];

const domains = new Set<string>();
const renames = new Map<string, string>();
for (const file of new Bun.Glob("id.*.ts").scanSync(I18N)) {
  const domain = file.slice(3, -3);
  if (domain === "pack") continue;
  domains.add(domain);
  for (const m of readFileSync(join(I18N, file), "utf8").matchAll(/^export const (id([A-Z]\w*))/gm)) {
    if (m[1] && m[2]) renames.set(m[1], `t${m[2]}`);
  }
}
const identifier = new RegExp(`\\b(${[...renames.keys()].join("|")})\\b`, "g");

/** `src/…` path a module specifier points to, or null for packages. */
function target(spec: string, from: string): string | null {
  if (spec.startsWith("@/")) return normalize(join("src", spec.slice(2)));
  if (spec.startsWith(".")) return normalize(join(dirname(from), spec));
  return null;
}

const changed: string[] = [];
const sources = ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "scripts/**/*.ts"];
for (const pattern of sources) {
  for (const file of new Bun.Glob(pattern).scanSync(ROOT)) {
    if (KEEP.some((re) => re.test(file))) continue;
    const before = readFileSync(file, "utf8");
    let touched = false;
    const after = before.replace(/(from\s+|import\(\s*)(["'])([^"']+)\2/g, (whole, lead: string, q: string, spec) => {
      const to = target(spec, file);
      const m = to && new RegExp(`^${I18N}/id\\.(.+?)(\\.ts)?$`).exec(relative(ROOT, join(ROOT, to)));
      if (!m?.[1] || !domains.has(m[1])) return whole;
      touched = true;
      return `${lead}${q}${spec.replace(/id\.([^/]+)$/, "en.$1")}${q}`;
    });
    if (!touched) continue;
    const renamed = after.replace(identifier, (name) => renames.get(name) ?? name);
    if (renamed !== before) {
      writeFileSync(file, renamed);
      changed.push(file);
    }
  }
}

if (changed.length) {
  // import order changes with the new module names (`./en.*` sorts before `./foo`); let biome re-sort them
  const biome = Bun.spawnSync(["node_modules/.bin/biome", "check", "--write", ...changed], { stdout: "inherit" });
  if (biome.exitCode !== 0) throw new Error(`codemod-i18n: biome check --write failed on ${changed.length} file(s)`);
}
console.info(`codemod-i18n: ${changed.length} file(s) rewritten, ${renames.size} identifiers, ${domains.size} domains`);
