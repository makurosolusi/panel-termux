// PUT /sites/:name/env: "Simpan" writes .env only; "Simpan dan mulai ulang" runs job site.env with revert (D18–D20).
import { copyFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { JobAccepted, SiteEnvSaved } from "../../shared/site.types";
import { recordAudit } from "../audit.service";
import { appName } from "../deploy/deploy.steps";
import { log } from "../log.service";
import { ApiError } from "../routes/http.error";
import { type Pm2Proc, Pm2UnavailableError } from "../system/system.types";
import { assertEnvEntries, ENV_KEY_RE, EnvInputError, envKeys, updateEnv } from "./env.file";
import { type JobRunner, type JobSpec, type StepDef, StepError } from "./job.runner";
import type { SiteCtx } from "./site.checks";
import { readTextOrNull, writeAtomic } from "./site.files";
import type { SiteRow } from "./site.jobs";
import { restartSteps } from "./site.steps";

const ENV_MODE = 0o600;
/** Copy of .env taken by `env_write`; restored on failure or by cleanup, removed when the job ends. */
export const ENV_PREV = ".env.panel-prev";

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const invalid = (key: string, reason: string) =>
  new ApiError(400, "invalid_env", `env ${key}: ${reason}`, { key, reason });

/** Keys the panel owns in a managed site's .env (server-enforced, D20). */
export const lockedEnvKeys = (s: SiteRow): string[] =>
  s.managed ? ["PORT", ...(s.database ? ["DATABASE_URL"] : [])] : [];

/** .env changed after the app's last (re)start: Bun reads .env only at start (D19, E6). */
export function restartPending(s: SiteRow, proc: Pm2Proc | undefined): boolean {
  const path = join(s.dir, ".env");
  if (!proc?.startedAtMs || !existsSync(path)) return false;
  return statSync(path).mtimeMs > proc.startedAtMs;
}

/** Validated `set` (object of representable values) or 400 `invalid_env {key, reason}`. */
export function envInput(v: unknown): Record<string, string> {
  if (v === undefined) return {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw invalid("set", "key");
  try {
    assertEnvEntries(v as Record<string, unknown>);
  } catch (e) {
    if (e instanceof EnvInputError) throw invalid(e.key, e.reason);
    throw e;
  }
  return v as Record<string, string>;
}

/** env_write with a `.env.panel-prev` copy; undo puts the old bytes back and restarts the app on them. */
function envWriteStep(ctx: SiteCtx, s: SiteRow, set: Record<string, string>, unset: string[]): StepDef {
  const path = join(s.dir, ".env");
  const prev = join(s.dir, ENV_PREV);
  let existed = false;
  return {
    key: "env_write",
    async run() {
      try {
        existed = existsSync(path);
        if (existed) copyFileSync(path, prev);
        writeAtomic(path, updateEnv(readTextOrNull(path) ?? "", set, unset), { mode: ENV_MODE });
      } catch (e) {
        throw new StepError("env_failed", {}, (e as Error).message);
      }
      return { code: "env_updated", params: { set: Object.keys(set).length, unset: unset.length } };
    },
    async undo() {
      if (existed) renameSync(prev, path);
      else rmSync(path, { force: true });
      if (await ctx.system.pm2.control(appName(s), "restart"))
        log.info(`[sites] ${s.name}: old .env restored, restarted`);
    },
  };
}

/** Step that puts `.env.panel-prev` back (cleanup of an interrupted site.env). */
export const envRestoreStep = (s: SiteRow): StepDef => ({
  key: "env_write",
  async run() {
    renameSync(join(s.dir, ENV_PREV), join(s.dir, ".env"));
    return { code: "env_restored" };
  },
});

/** site.env: env_write → app_restart → health; any end removes `.env.panel-prev`. */
function envJob(ctx: SiteCtx, actorId: string, s: SiteRow, set: Record<string, string>, unset: string[]): JobSpec {
  const dropPrev = () => rmSync(join(s.dir, ENV_PREV), { force: true });
  return {
    kind: "site.env",
    target: s.name,
    actorId,
    input: { site: s.name, set: Object.keys(set), unset },
    steps: [envWriteStep(ctx, s, set, unset), ...restartSteps(ctx, s)],
    onSuccess: dropPrev,
    afterRollback: async () => dropPrev(),
  };
}

/** PUT /sites/:name/env. Keys only reach audit/logs, never values. */
export async function saveEnv(
  ctx: SiteCtx,
  jobs: JobRunner,
  actorId: string,
  s: SiteRow,
  body: unknown,
): Promise<SiteEnvSaved | JobAccepted> {
  const b = obj(body);
  const set = envInput(b.set);
  const unset = b.unset ?? [];
  if (!Array.isArray(unset)) throw invalid("unset", "key");
  for (const k of unset) if (typeof k !== "string" || !ENV_KEY_RE.test(k)) throw invalid(String(k), "key");
  const locked = lockedEnvKeys(s).filter((k) => k in set || unset.includes(k));
  if (locked.length)
    throw new ApiError(400, "env_locked", `${locked.join(", ")} are set by the panel`, { keys: locked });
  if (!existsSync(s.dir)) throw new ApiError(409, "no_folder", `site folder ${s.dir} does not exist`);
  jobs.assertIdle();
  const meta = { set: Object.keys(set), unset, restart: b.restart === true };
  if (b.restart === true) {
    const jobId = jobs.start(envJob(ctx, actorId, s, set, unset as string[]));
    recordAudit(ctx.db, { actorId, action: "site.env_update", target: s.name, meta: { ...meta, jobId } });
    return { jobId };
  }
  const path = join(s.dir, ".env");
  const next = updateEnv(readTextOrNull(path) ?? "", set, unset as string[]);
  writeAtomic(path, next, { mode: ENV_MODE });
  recordAudit(ctx.db, { actorId, action: "site.env_update", target: s.name, meta });
  log.info(`[sites] env of ${s.name} saved by ${actorId} (restart pending)`);
  const proc = await ctx.system.pm2.procs().then(
    (ps) => ps.find((p) => p.name === appName(s)),
    (e: unknown) => {
      if (e instanceof Pm2UnavailableError) return undefined; // pm2 down: nothing running, nothing pending
      throw e;
    },
  );
  return { envKeys: envKeys(next), restartPending: restartPending(s, proc) };
}
