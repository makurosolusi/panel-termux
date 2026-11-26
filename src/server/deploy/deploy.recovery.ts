// job.cleanup steps for an interrupted/failed site.deploy or site.rollback (PLAN/03 §4.11): inspect → swap repair
// (state table) → run_script → apps_entry → app_restart → health. Every step is idempotent, so a cleanup that is
// itself cut off can simply run again.
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { site } from "../db/schema";
import { parseApps, removeApp } from "../sites/apps.file";
import { errMsg, type StepDef, StepError } from "../sites/job.step";
import { type SiteCtx, sitePaths } from "../sites/site.checks";
import { readTextOrNull, writeAtomic } from "../sites/site.files";
import { healthStep, pm2Call, restartApp } from "./deploy.restart";
import {
  appName,
  appsEntryStep,
  binsOf,
  type DeployState,
  newState,
  runScriptStep,
  type SiteRow,
} from "./deploy.steps";
import type { HealthTiming } from "./health.check";
import { baselineOf } from "./health.check";
import { type RepairInput, repairSwap } from "./swap";

/** The original job being cleaned up: kind and its `job.input` journal. */
export type CleanupOf = {
  kind: "site.deploy" | "site.rollback";
  target: string;
  input: Record<string, unknown> | null;
};

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Journal → repair input; a pre-0007 job without input only gets the existence-based rows. */
export function repairInput(of: CleanupOf): RepairInput {
  const i = of.input ?? {};
  if (of.kind === "site.rollback") {
    return { kind: "rollback", toSha256: str(i.toSha256) ?? "", fromSha256: str(i.fromSha256) };
  }
  return {
    kind: "deploy",
    sha256: str(i.sha256) ?? "",
    fromSha256: str(i.fromSha256),
    firstDeploy: i.firstDeploy === true,
  };
}

/** Cleanup step list; `null` site row = the site is gone (inspect → nothing to do, the rest skipped). */
export function cleanupSteps(
  ctx: SiteCtx,
  of: CleanupOf,
  opts: { timing?: HealthTiming; healthTimeoutMs?: number } = {},
): { steps: StepDef[]; state: DeployState } {
  const s: SiteRow | undefined = ctx.db.select().from(site).where(eq(site.name, of.target)).get();
  const st = newState(s?.runtime ?? "native");
  const skip = (code: string) => ({ code, skipped: true });
  const input = repairInput(of);

  const inspect: StepDef = {
    key: "inspect",
    async run() {
      if (!s) return { code: "inspect_nothing" };
      const p = binsOf(s);
      const count = [p.next, p.drop, p.swp].filter((f) => existsSync(f)).length + (existsSync(p.app) ? 0 : 1);
      return count ? { code: "inspect_found", params: { count } } : { code: "inspect_nothing" };
    },
  };
  if (!s) {
    const none = (key: StepDef["key"]): StepDef => ({ key, run: async () => skip("inspect_nothing") });
    return { steps: [inspect, none("swap"), none("app_restart")], state: st };
  }

  const swap: StepDef = {
    key: "swap",
    irreversible: true,
    async run() {
      let row: string;
      try {
        row = await repairSwap(binsOf(s), input);
      } catch (e) {
        throw new StepError("swap_failed", {}, errMsg(e));
      }
      if (row === "D5") return { code: "swap_back", params: { row }, skipped: true };
      // S3: no live binary and none to put back (a first deploy cut off): only leftovers were removed.
      return { code: row === "S3" ? "swap_nothing_live" : "swap_back", params: { row } };
    },
  };

  const firstDeployGone = input.kind === "deploy" && input.firstDeploy;
  const entry = appsEntryStep(ctx, s, st);
  const appsEntry: StepDef = {
    key: "apps_entry",
    irreversible: true,
    async run(c) {
      if (!s.managed) return skip("apps_adopted_skip");
      if (existsSync(binsOf(s).app)) return entry.run(c);
      const { appsJson } = sitePaths(ctx);
      const text = readTextOrNull(appsJson);
      let names: string[];
      try {
        names = parseApps(text).map((a) => a.name as string);
      } catch (e) {
        throw new StepError("apps_json_invalid", {}, errMsg(e));
      }
      // Entry removed only when the binary is gone and the job was the site's first deploy (D5: no entry without app).
      if (!firstDeployGone || !names.includes(appName(s))) return { code: "apps_unchanged" };
      writeAtomic(appsJson, removeApp(text, appName(s)), { backup: true });
      return { code: "apps_removed", params: { name: appName(s) } };
    },
  };

  const restart: StepDef = {
    key: "app_restart",
    irreversible: true,
    async run() {
      const name = appName(s);
      const known = await pm2Call(async () => (await ctx.system.pm2.list()).some((a) => a.name === name));
      if (existsSync(binsOf(s).app)) {
        st.restarted = true;
        const out = await restartApp(ctx, s, st.appsWrite === "apps_migrated");
        st.baseline = await pm2Call(() => baselineOf(ctx.system.pm2, name));
        return out;
      }
      if (!known) return skip("app_not_deployed");
      if (s.managed) await pm2Call(() => ctx.system.pm2.remove(name));
      else await pm2Call(() => ctx.system.pm2.control(name, "stop"));
      return { code: "app_removed", params: { name } };
    },
  };

  const health = healthStep(ctx, s, st, opts.timing, opts.healthTimeoutMs);
  const healthIfRestarted: StepDef = {
    key: "health",
    run: async (c) => (st.restarted ? health.run(c) : skip("app_not_deployed")),
  };

  return {
    steps: [inspect, swap, { ...runScriptStep(s, st), irreversible: true }, appsEntry, restart, healthIfRestarted],
    state: st,
  };
}
