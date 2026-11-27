// Init step 7 "pm2" (PLAN/07 §4.1 row 7, §4.5, K6, C1, C3, B14): on a phone without a pm2 setup it writes the shipped
// ecosystem, `apps.json` = [] and the embedded pm2 run script (--no-auto-exit, PM2_HOME), then `sv up pm2`. An
// existing setup is never written (no integration fix from the CLI, K6): what the Setup planners would change is
// reported with a pointer to the UI. pm2 is never restarted and the pm2 CLI never called.
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error TS2307: Bun embeds the shipped run script as text (`type: "text"`); tsc has no module for it.
import PM2_RUN from "../../deploy/pm2/run" with { type: "text" };
import { snippetCurrent } from "../server/sites/ecosystem.patch";
import { ecosystemFromTemplate } from "../server/sites/ecosystem.template";
import { planRunScriptFix } from "../server/sites/runscript.patch";
import { writeAtomic } from "../server/sites/site.files";
import { probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import { stepRuns } from "./init.plan";
import { INIT_TIMING, type InitTiming, installServiceDir, sv } from "./init.runit";
import { defineStep, type InitContext, type PlanLine } from "./init.types";

/** Embedded pm2 run script (deploy/pm2/run). */
export const PM2_RUN_TEMPLATE = PM2_RUN as string;
const APPS_JSON = "[]\n";
const setupHint = () => tr("open Sites → Setup in the panel", "buka Situs → Persiapan di panel");

/** One of the three pm2 files: absent, byte-equal to what init writes (a resumed run), or anything else. */
type Part = "missing" | "ours" | "other";
/** What step 7 found (paths + each part); `ecosystem`/`run` text kept for the read-only integration report. */
export type Pm2State = {
  sitesDir: string;
  parts: { ecosystem: Part; apps: Part; service: Part };
  ecosystem: string | null;
  run: Buffer | null;
  runIsLink: boolean;
  runNlink: number;
  /** pm2-runtime is installed (the run script execs it). */
  runtime: boolean;
};

const readOrNull = (f: string) => (existsSync(f) ? readFileSync(f) : null);
const part = (bytes: Buffer | null, ours: string): Part =>
  bytes === null ? "missing" : bytes.equals(Buffer.from(ours)) ? "ours" : "other";

function detectPm2(ctx: InitContext): Pm2State {
  const { home, prefix, svdir } = ctx.host.paths;
  const sitesDir = join(home, "sites");
  const eco = readOrNull(join(sitesDir, "ecosystem.config.js"));
  const runPath = join(svdir, "pm2", "run");
  const run = readOrNull(runPath);
  const link = run !== null ? lstatSync(runPath) : null;
  // A pm2 folder without run is not ours either: installServiceDir never writes into an existing folder.
  const service: Part = !existsSync(join(svdir, "pm2"))
    ? "missing"
    : run === null
      ? "other"
      : part(run, PM2_RUN_TEMPLATE);
  return {
    sitesDir,
    parts: {
      ecosystem: part(eco, ecosystemFromTemplate(sitesDir, prefix)),
      apps: part(readOrNull(join(sitesDir, "apps.json")), APPS_JSON),
      service,
    },
    ecosystem: eco?.toString("utf8") ?? null,
    run,
    runIsLink: link?.isSymbolicLink() ?? false,
    runNlink: link?.nlink ?? 1,
    runtime: existsSync(probePaths(ctx.host.paths).pm2Runtime),
  };
}

/** Our setup goes in only when nothing of a hand-made one exists (K6); parts written by an interrupted run are ours. */
const writable = (s: Pm2State) =>
  !Object.values(s.parts).includes("other") && Object.values(s.parts).includes("missing");

const noRuntime = (ctx: InitContext): PlanLine => ({
  kind: "warning",
  text: tr("pm2 is not installed yet", "pm2 belum terpasang"),
  hint: tr(`run ${ctx.resumeCommand()} again in a terminal`, `jalankan lagi ${ctx.resumeCommand()} di terminal`),
});

/** Read-only integration report of an existing setup: the same planners the Setup card fixes with. */
function integrationLines(ctx: InitContext, s: Pm2State): PlanLine[] {
  const lines: PlanLine[] = [];
  if (s.ecosystem !== null && !snippetCurrent(s.ecosystem))
    lines.push({
      kind: "warning",
      text: tr(
        "ecosystem.config.js does not load the sites made by the panel yet (apps.json)",
        "ecosystem.config.js belum memuat situs buatan panel (apps.json)",
      ),
      hint: setupHint(),
    });
  if (
    s.run !== null &&
    planRunScriptFix({ bytes: s.run, isSymlink: s.runIsLink, nlink: s.runNlink }).kind !== "unchanged"
  )
    lines.push({
      kind: "warning",
      text: tr(
        "The pm2 service can stop by itself when no site is running",
        "Layanan pm2 bisa berhenti sendiri saat tidak ada situs berjalan",
      ),
      hint: setupHint(),
    });
  if (s.parts.service === "missing")
    lines.push({
      kind: "warning",
      text: tr("The pm2 service is not installed in runit yet", "Layanan pm2 belum dipasang di runit"),
      hint: setupHint(),
    });
  if (!s.runtime) lines.push(noRuntime(ctx));
  if (lines.length === 0)
    lines.push({
      kind: "info",
      text: tr("pm2 is already set up and not changed", "pm2 sudah diatur dan tidak diubah"),
      hint: setupHint(),
    });
  return lines;
}

/** Step 7 with `timing` (tests shorten the waits). */
export const createPm2Step = (timing: InitTiming = INIT_TIMING) =>
  defineStep<Pm2State>({
    id: "pm2",
    detect: async (ctx) => detectPm2(ctx),
    plan(ctx, s) {
      if (!writable(s)) return integrationLines(ctx, s);
      // M2: a pm2 service without pm2-runtime crash-loops in runsv; step 2 installs it only when it runs now
      if (!s.runtime && !stepRuns(ctx, "packages")) return [noRuntime(ctx)];
      return [
        {
          kind: "action",
          text: tr(
            "Setting up pm2 for sites (~/sites/ecosystem.config.js, apps.json, pm2 service)",
            "Menyiapkan pm2 untuk situs (~/sites/ecosystem.config.js, apps.json, layanan pm2)",
          ),
        },
      ];
    },
    async apply(ctx, s) {
      const { prefix } = ctx.host.paths;
      mkdirSync(s.sitesDir, { recursive: true });
      const files: [Part, string, string][] = [
        [s.parts.ecosystem, join(s.sitesDir, "ecosystem.config.js"), ecosystemFromTemplate(s.sitesDir, prefix)],
        [s.parts.apps, join(s.sitesDir, "apps.json"), APPS_JSON],
      ];
      for (const [p, file, text] of files) {
        if (p !== "missing") continue;
        writeAtomic(file, text);
        ctx.state.changed.push(file);
      }
      // Service last: runsv starts pm2-runtime only once its ecosystem exists.
      if (s.parts.service === "missing") installServiceDir(ctx, "pm2", PM2_RUN_TEMPLATE, false);
      await sv(ctx, ["up", "pm2"], timing);
      ctx.out.check("ok", tr("pm2 set up and started", "pm2 disiapkan dan dinyalakan"));
    },
  });

/** Step 7 (§4.1). */
export const pm2Step = createPm2Step();
