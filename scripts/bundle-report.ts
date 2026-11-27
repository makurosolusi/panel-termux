// SPA bundle budget check (PLAN/01 §3.11, §6): `bun run bundle:check`. Exits 1 when a budget is exceeded.
// Builds src/web/index.html like the binary does (splitting + minify), then sums gzip sizes per chunk group.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

const KB = 1024;
/**
 * gzip budgets (DECISIONS B30, E6): `/` = bootstrap entry + `app.mount` chunk with their static imports; `/panel` =
 * that plus the app (shell) and Ringkasan page JS on first load. The id pack has a soft budget (warning only).
 */
const BUDGET = { landing: 150 * KB, panel: 215 * KB, idPack: 45 * KB } as const;
/** Source modules that must stay out of `/` (they belong to the lazy `app` chunk). */
const APP_ONLY = /^src\/web\/(panel|dev|site|backup|deploy|layout\/app\.layout)/;
/** The only dictionaries `/` may carry; any other `src/web/i18n/*.ts` dictionary there is a leak. */
const ENTRY_I18N = /^src\/web\/i18n\/(en|id)\.(app|common|shell|session|landing)\.ts$/;
/** The overlay pack and the detector are not dictionaries (the pack is lazy, the detector is the bootstrap's). */
const NOT_DICTIONARY = /^src\/web\/i18n\/(id\.pack|locale\.detect)\.ts$/;
const isDictionary = (input: string) => /^src\/web\/i18n\//.test(input) && !NOT_DICTIONARY.test(input);
const isLeak = (input: string) => APP_ONLY.test(input) || (isDictionary(input) && !ENTRY_I18N.test(input));
const MOUNT_INPUT = "src/web/app.mount.tsx";
const PACK_INPUT = "src/web/i18n/id.pack.ts";
const LOGIN_INPUT = "src/web/pages/login.page.tsx";
const APP_INPUT = "src/web/app.routes.tsx";
/** The page `/panel` opens on (its own lazy chunk since pages load per route). */
const PANEL_HOME_INPUT = "src/web/panel/overview.page.tsx";

type MetaOutput = { inputs: Record<string, unknown>; imports?: { path: string; kind: string }[]; entryPoint?: string };
type Meta = { outputs: Record<string, MetaOutput> };

const outdir = await mkdtemp(join(tmpdir(), "panel-bundle-"));
try {
  const result = await Bun.build({
    entrypoints: ["./src/web/index.html"],
    outdir,
    splitting: true,
    minify: true,
    metafile: true,
    plugins: [tailwind],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success || !result.metafile) {
    for (const l of result.logs) console.error(l);
    throw new Error("bundle-report: Bun.build of src/web/index.html failed");
  }
  const raw: unknown = result.metafile; // object in Bun ≥ 1.4.5, JSON string before
  const meta = (typeof raw === "string" ? JSON.parse(raw) : raw) as Meta;
  const outputs = meta.outputs;
  const name = (p: string) => p.replace(/^.*\//, "");
  const byName = new Map(Object.entries(outputs).map(([p, o]) => [name(p), { path: p, ...o }]));
  const gz = new Map<string, number>();
  for (const out of result.outputs) {
    if (out.path.endsWith(".js")) gz.set(name(out.path), Bun.gzipSync(await out.arrayBuffer()).length);
  }

  /** JS files loaded with `file` before any dynamic import runs. */
  const closure = (file: string, seen = new Set<string>()): Set<string> => {
    if (seen.has(file)) return seen;
    seen.add(file);
    for (const imp of byName.get(file)?.imports ?? []) {
      if (imp.kind === "import-statement" && imp.path.endsWith(".js")) closure(name(imp.path), seen);
    }
    return seen;
  };
  const jsFor = (entryPoint: string) =>
    [...byName.keys()].find((f) => f.endsWith(".js") && byName.get(f)?.entryPoint === entryPoint);
  const found = {
    boot: jsFor("src/web/index.html"),
    mount: jsFor(MOUNT_INPUT),
    pack: jsFor(PACK_INPUT),
    login: jsFor(LOGIN_INPUT),
    app: jsFor(APP_INPUT),
    home: jsFor(PANEL_HOME_INPUT),
  };
  const missing = Object.entries(found).filter(([, f]) => !f);
  if (missing.length) throw new Error(`bundle-report: chunk not found for ${missing.map(([k]) => k).join(", ")}`);
  const js = found as Record<keyof typeof found, string>;

  const boot = closure(js.boot);
  /** `/` = what loads before first render: the bootstrap, then the `app.mount` chunk (one extra hop). */
  const entry = new Set([...boot, ...closure(js.mount)]);
  const sum = (files: Iterable<string>) => [...files].reduce((n, f) => n + (gz.get(f) ?? 0), 0);
  const only = (s: Set<string>, base: Set<string> = entry) => [...s].filter((f) => !base.has(f));
  const mount = only(entry, boot);
  const pack = only(closure(js.pack), boot);
  const login = only(closure(js.login));
  const app = only(closure(js.app));
  const panel = new Set([...app, ...only(closure(js.home))]);
  const kb = (n: number) => `${(n / KB).toFixed(1)} KB`;
  const inputsOf = (files: Iterable<string>) => [...files].flatMap((f) => Object.keys(byName.get(f)?.inputs ?? {}));
  const leaked = inputsOf(entry).filter(isLeak);
  /** The bootstrap must not evaluate any dictionary before the overlay is registered (DECISIONS E5). */
  const bootDictionaries = inputsOf(boot).filter(isDictionary);

  const rows = [
    { group: "bootstrap", files: boot.size, gzip: sum(boot), budget: null, soft: false },
    { group: "mount (hop 2)", files: mount.length, gzip: sum(mount), budget: null, soft: false },
    { group: "entry (/)", files: entry.size, gzip: sum(entry), budget: BUDGET.landing, soft: false },
    { group: "login (lazy)", files: login.length, gzip: sum(login), budget: null, soft: false },
    { group: "app (lazy)", files: app.length, gzip: sum(app), budget: null, soft: false },
    {
      group: "/panel initial",
      files: entry.size + panel.size,
      gzip: sum(entry) + sum(panel),
      budget: BUDGET.panel,
      soft: false,
    },
    { group: "id pack (lazy)", files: pack.length, gzip: sum(pack), budget: BUDGET.idPack, soft: true },
  ];
  let failed = leaked.length > 0 || bootDictionaries.length > 0;
  for (const r of rows) {
    const over = r.budget !== null && r.gzip > r.budget;
    if (!r.soft) failed ||= over;
    const limit = r.budget === null ? "" : ` / ${kb(r.budget)} ${over ? (r.soft ? "OVER (soft)" : "OVER") : "ok"}`;
    console.info(
      `${r.group.padEnd(16)} ${String(r.files).padStart(2)} file(s)  ${kb(r.gzip).padStart(9)} gzip${limit}`,
    );
  }
  if (leaked.length) console.error(`entry contains app-only modules: ${leaked.slice(0, 5).join(", ")}`);
  if (bootDictionaries.length) console.error(`bootstrap contains dictionaries: ${bootDictionaries.join(", ")}`);
  console.info(failed ? "bundle:check FAILED" : "bundle:check ok");
  process.exitCode = failed ? 1 : 0;
} finally {
  await rm(outdir, { recursive: true, force: true });
}
