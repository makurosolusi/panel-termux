// SPA bundle budget check (PLAN/01 §3.11, §6): `bun run bundle:check`. Exits 1 when a budget is exceeded.
// Builds src/web/index.html like the binary does (splitting + minify), then sums gzip sizes per chunk group.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tailwind from "bun-plugin-tailwind";

const KB = 1024;
/** gzip budgets: `/` = entry JS; `/panel` = entry + app (shell) + Ringkasan page JS on first load. */
const BUDGET = { landing: 150 * KB, panel: 200 * KB } as const;
/** Source modules that must stay out of the entry (they belong to the lazy `app` chunk). */
const APP_ONLY = /^src\/web\/(panel|dev|site|backup|deploy|layout\/app\.layout)/;
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
  const entryJs = jsFor("src/web/index.html");
  const loginJs = jsFor(LOGIN_INPUT);
  const appJs = jsFor(APP_INPUT);
  const homeJs = jsFor(PANEL_HOME_INPUT);
  if (!entryJs || !loginJs || !appJs || !homeJs)
    throw new Error(`bundle-report: chunk not found (entry=${entryJs} login=${loginJs} app=${appJs})`);

  const entry = closure(entryJs);
  const sum = (files: Iterable<string>) => [...files].reduce((n, f) => n + (gz.get(f) ?? 0), 0);
  const only = (s: Set<string>) => [...s].filter((f) => !entry.has(f));
  const login = only(closure(loginJs));
  const app = only(closure(appJs));
  const panel = new Set([...app, ...only(closure(homeJs))]);
  const kb = (n: number) => `${(n / KB).toFixed(1)} KB`;
  const leaked = [...entry].flatMap((f) => Object.keys(byName.get(f)?.inputs ?? {}).filter((i) => APP_ONLY.test(i)));

  const rows = [
    { group: "entry (/)", files: entry.size, gzip: sum(entry), budget: BUDGET.landing },
    { group: "login (lazy)", files: login.length, gzip: sum(login), budget: null },
    { group: "app (lazy)", files: app.length, gzip: sum(app), budget: null },
    { group: "/panel initial", files: entry.size + panel.size, gzip: sum(entry) + sum(panel), budget: BUDGET.panel },
  ];
  let failed = leaked.length > 0;
  for (const r of rows) {
    const over = r.budget !== null && r.gzip > r.budget;
    failed ||= over;
    const limit = r.budget === null ? "" : ` / ${kb(r.budget)} ${over ? "OVER" : "ok"}`;
    console.info(
      `${r.group.padEnd(16)} ${String(r.files).padStart(2)} file(s)  ${kb(r.gzip).padStart(9)} gzip${limit}`,
    );
  }
  if (leaked.length) console.error(`entry contains app-only modules: ${leaked.slice(0, 5).join(", ")}`);
  console.info(failed ? "bundle:check FAILED" : "bundle:check ok");
  process.exitCode = failed ? 1 : 0;
} finally {
  await rm(outdir, { recursive: true, force: true });
}
