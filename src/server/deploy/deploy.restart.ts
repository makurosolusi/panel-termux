// pm2 side of site.deploy / site.rollback / job.cleanup: app_restart (with the health baseline), the revert after an
// undo, and the health step (stderr tail logged redacted on failure). pm2 down → StepError `pm2_not_running`.

import { existsSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { decodeEnvValue, findEnvLine } from "../../shared/env.codec";
import { siteHostname } from "../db/schema";
import { log } from "../log.service";
import { envKeys } from "../sites/env.file";
import { errMsg, type StepDef, StepError, type StepOutcome } from "../sites/job.step";
import { type SiteCtx, sitePaths } from "../sites/site.checks";
import { readTextOrNull } from "../sites/site.files";
import { redactLines } from "../system/log.redact";
import { Pm2UnavailableError, SystemError } from "../system/system.types";
import { appName, binsOf, type DeployState, type SiteRow } from "./deploy.steps";
import { baselineOf, type HealthTiming, waitHealthy } from "./health.check";

const STDERR_TAIL_LINES = 20;
const MS_PER_SEC = 1000;
/** Runs a pm2 call: pm2 down → StepError `pm2_not_running`, other system errors → `pm2_failed`. */
export async function pm2Call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Pm2UnavailableError) throw new StepError("pm2_not_running", {}, e.message);
    if (e instanceof SystemError) throw new StepError("pm2_failed", {}, e.message);
    throw e;
  }
}

/**
 * Restarts the site's pm2 app. A managed app pm2 does not know, or whose entry was just migrated (pm2 keeps the
 * old script on `start --only`, E3), is (re)loaded from ecosystem.config.js; otherwise `pm2 restart`.
 */
export async function restartApp(ctx: SiteCtx, s: SiteRow, reload: boolean): Promise<StepOutcome> {
  const name = appName(s);
  const pm2 = ctx.system.pm2;
  return pm2Call(async () => {
    const known = (await pm2.list()).some((a) => a.name === name);
    if (s.managed && (reload || !known)) {
      if (known) await pm2.remove(name);
      const a = await pm2.startFromEcosystem(sitePaths(ctx).ecosystem, name);
      if (!a) throw new StepError("app_not_loaded", { name }, `ecosystem.config.js did not load ${name}`);
      return { code: "app_started", params: { name } };
    }
    if (!(await pm2.control(name, "restart"))) throw new StepError("app_missing", { name });
    return { code: "app_restarted", params: { name } };
  });
}

/** app_restart; the pm2 baseline for `health` is read right after it. */
export const appRestartStep = (ctx: SiteCtx, s: SiteRow, st: DeployState): StepDef => ({
  key: "app_restart",
  async run() {
    st.restarted = true;
    const out = await restartApp(ctx, s, st.appsWrite === "apps_migrated");
    st.baseline = await pm2Call(() => baselineOf(ctx.system.pm2, appName(s)));
    return out;
  },
});

/**
 * Rollback hook: pm2 back in line with the restored files. No binary left (first deploy undone) → a managed app is
 * removed from pm2 again, an adopted one stopped. Returns what was done (null = nothing).
 */
export async function revertApp(ctx: SiteCtx, s: SiteRow, st: DeployState): Promise<string | null> {
  if (!st.restarted) return null;
  const name = appName(s);
  if (existsSync(binsOf(s).app)) return (await restartApp(ctx, s, st.appsWrite === "apps_migrated")).code;
  if (s.managed) return (await pm2Call(() => ctx.system.pm2.remove(name))) ? "app_removed" : null;
  return (await pm2Call(() => ctx.system.pm2.control(name, "stop"))) ? "app_stopped" : null;
}

/** Values of the site's .env (masked in the stderr tail besides the generic patterns). */
function envSecrets(dir: string): string[] {
  const text = readTextOrNull(`${dir}/.env`) ?? "";
  return envKeys(text).flatMap((k) => {
    const raw = findEnvLine(text, k);
    return raw === null ? [] : [decodeEnvValue(raw)];
  });
}

/** Writes the last stderr lines of the app (redacted) to the panel log, so a failed health check can be diagnosed. */
async function logStderrTail(ctx: SiteCtx, s: SiteRow): Promise<void> {
  try {
    const lines = await ctx.system.pm2.readLog(appName(s), "err", STDERR_TAIL_LINES);
    if (!lines?.length) return;
    const r = redactLines(lines, envSecrets(s.dir));
    log.warn(`[deploy] ${s.name}: stderr of ${appName(s)} (${r.redacted} masked):\n${r.lines.join("\n")}`);
  } catch (e) {
    log.warn(`[deploy] ${s.name}: stderr of ${appName(s)} unavailable: ${errMsg(e)}`);
  }
}

/** health per site settings (path/expect/timeout, Host = main domain); `timeoutMs` overrides (tests). */
export function healthStep(
  ctx: SiteCtx,
  s: SiteRow,
  st: DeployState,
  timing?: HealthTiming,
  timeoutMs?: number,
): StepDef {
  return {
    key: "health",
    async run() {
      const host = ctx.db
        .select({ h: siteHostname.hostname })
        .from(siteHostname)
        .where(eq(siteHostname.siteName, s.name))
        .orderBy(asc(siteHostname.createdAt))
        .get()?.h;
      const target = {
        app: appName(s),
        port: s.port,
        path: s.healthPath,
        expect: s.healthExpect,
        timeoutMs: timeoutMs ?? s.healthTimeoutSec * MS_PER_SEC,
        ...(host ? { host } : {}),
      };
      try {
        return await pm2Call(() => waitHealthy(ctx.system, target, st.baseline, timing));
      } catch (e) {
        await logStderrTail(ctx, s);
        throw e;
      }
    },
  };
}
