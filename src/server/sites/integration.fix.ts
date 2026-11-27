// In-UI integration fixes (PLAN/06 §3.4–3.7, §6.2; DECISIONS C1/C3/C6): preview, apply, restore and the checked pm2
// restart. Synchronous under jobs.assertIdle() + backup.busy() + one `integration` action lock (F5). File contents and
// env values never reach the audit or the log.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import type { FixEffects, FixKey, FixPreview, FixResult, Pm2RestartResult } from "../../shared/fix.types";
import { recordAudit } from "../audit.service";
import { log } from "../log.service";
import type { Monitor } from "../monitor/monitor.contract";
import { createActionLocks } from "../panel/action.lock";
import { ApiError } from "../routes/http.error";
import { ensureAppsJson } from "./apps.file";
import { ecosystemFromTemplate } from "./ecosystem.template";
import { fixIoError, listFixBackups, resolveFixBackup, saveFixBackup } from "./fix.backup";
import {
  checkRunScriptSyntax,
  FIX_KEYS,
  type FilePatch,
  type FixCtx,
  fixTargetPath,
  NO_EFFECTS,
  onlinePm2Apps,
  prefixOf,
  runnablePanelApps,
  runScriptPath,
  sha256,
  validateEcosystem,
} from "./fix.plan";
import { planFix } from "./fix.planners";
import type { IntegrationService } from "./integration.service";
import type { JobRunner } from "./job.runner";
import { validateRunScript } from "./runscript.patch";
import { sitePaths } from "./site.checks";
import { readBytesOrNull, writeAtomic } from "./site.files";

/** How the checked pm2 restart waits for apps to come back (PLAN/06 §3.7: every 2 s, up to 30 s). */
export type Pm2RestartPoll = { intervalMs: number; timeoutMs: number };
/** Production timing of the checked restart (HTTP idle timeout must stay above it, spa.serve). */
export const DEFAULT_RESTART_POLL: Pm2RestartPoll = { intervalMs: 2_000, timeoutMs: 30_000 };
const MS_PER_SEC = 1000;
const SITES_DIR_MODE = 0o700;
const NEW_FILE_MODE = { ecosystem: 0o644, pm2_run: 0o755, apps_json: 0o644 } as const;

/** Deps of the fix service; `ctx.dataDir` holds the fix backups. */
export type IntegrationFixDeps = {
  ctx: FixCtx & { dataDir: string };
  jobs: Pick<JobRunner, "assertIdle">;
  backupBusy?: () => boolean;
  monitor?: Pick<Monitor, "noteIntentionalRestart">;
  integration: IntegrationService;
  poll?: Pm2RestartPoll;
};

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Fix key from the URL, or 404 `not_found`. */
function fixKey(raw: string): FixKey {
  if (!FIX_KEYS.includes(raw as FixKey)) throw new ApiError(404, "not_found", `unknown fix ${JSON.stringify(raw)}`);
  return raw as FixKey;
}

/** Runs `fn`; ENOSPC → 507 `disk_full`, EACCES/EPERM → 422 `not_writable`, other errors re-thrown with `op`. */
async function io<T>(op: string, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = fixIoError(e);
    if (code === "disk_full") throw new ApiError(507, "disk_full", `${op}: no space left on the device`);
    if (code === "not_writable") throw new ApiError(422, "not_writable", `${op}: permission denied`);
    if (e instanceof ApiError) throw e;
    throw new Error(`${op}: ${(e as Error).message}`, { cause: e });
  }
}

/** Fix service behind /api/panel/integration/{fixes,backups,pm2}. */
export function createIntegrationFixes(deps: IntegrationFixDeps) {
  const { ctx, jobs, integration } = deps;
  const { db, system, dataDir } = ctx;
  const poll = deps.poll ?? DEFAULT_RESTART_POLL;
  const withLock = createActionLocks();
  let restarting: Promise<Pm2RestartResult> | null = null;
  // ponytail: in memory, so a panel restart forgets it; the audit log has the history if that ever matters.
  let lostAfter: string | null = null; // ecosystem backup id after which a checked restart already lost apps

  /** 409 `busy` while a site job or a backup runs, then the `integration` lock (a second click is 409 too). */
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    jobs.assertIdle();
    if (deps.backupBusy?.()) throw new ApiError(409, "busy", "a backup run or restore is in progress");
    return withLock("integration", fn);
  }

  const result = async (key: FixResult["key"], outcome: FixResult["outcome"]): Promise<FixResult> => ({
    key,
    outcome,
    restart: null,
    integration: await integration.refresh(),
  });

  // apps.json needs no load test: the rebuild writes JSON.stringify output, and the ecosystem block tolerates any bytes.
  const validate = async (patch: FilePatch, probe: Parameters<typeof validateEcosystem>[3]) => {
    if (patch.file === "apps_json") return null;
    if (patch.file === "ecosystem") return validateEcosystem(ctx, patch.candidate, patch.mode, probe);
    const r = await validateRunScript(
      patch.path,
      patch.original,
      patch.candidate,
      patch.line,
      patch.mode,
      prefixOf(ctx),
    );
    return r.ok ? null : r.detail;
  };

  /** sites_dir_create: folder (700), apps.json `[]` and the shipped ecosystem, each only when missing. */
  async function createMissing(actorId: string, key: FixKey, effects: FixEffects): Promise<void> {
    if (effects.dir) {
      const dir = effects.dir;
      await io(`create ${dir}`, () => mkdirSync(dir, { recursive: true, mode: SITES_DIR_MODE }));
    }
    await io("create apps.json", () => ensureAppsJson(ctx));
    const path = effects.newEcosystem;
    if (path) {
      const bytes = Buffer.from(ecosystemFromTemplate(sitePaths(ctx).sitesDir, prefixOf(ctx)));
      const detail = await io(`validate ${path}`, () => validateEcosystem(ctx, bytes, NEW_FILE_MODE.ecosystem, null));
      if (detail !== null) {
        recordAudit(db, {
          actorId,
          action: "integration.fix",
          target: key,
          meta: { key, outcome: "validation_failed" },
        });
        throw new ApiError(422, "validation_failed", `fix ${key} was not applied: the template does not load`, {
          detail,
        });
      }
      if (existsSync(path)) throw new ApiError(409, "changed_during_fix", `${path} appeared while the fix ran`);
      await io(`write ${path}`, () => writeAtomic(path, bytes, { mode: NEW_FILE_MODE.ecosystem }));
    }
    const meta = { key, outcome: "applied", ...(path ? { newEcosystem: true } : {}) };
    recordAudit(db, { actorId, action: "integration.fix", target: key, meta });
    log.info(`[integration] fix ${key} applied by ${actorId}${path ? " (ecosystem from the template)" : ""}`);
  }

  /** Steps 7–11 of PLAN/06 §3.4: re-check, backup, atomic write, sha after, audit. */
  async function write(actorId: string, key: FixKey, patch: FilePatch): Promise<void> {
    const now = readBytesOrNull(patch.path);
    if (now === null || sha256(now) !== patch.sha)
      throw new ApiError(409, "changed_during_fix", `${patch.path} changed while the fix ran`);
    const shaCand = sha256(patch.candidate);
    const backup = await io(`back up ${patch.path}`, () => saveFixBackup(dataDir, patch.file, patch.original, shaCand));
    await io(`write ${patch.path}`, () => writeAtomic(patch.path, patch.candidate, { mode: patch.mode }));
    const live = readBytesOrNull(patch.path);
    const shaAfter = live === null ? null : sha256(live);
    if (shaAfter !== shaCand) log.warn(`[integration] ${patch.path} differs from the fix right after writing it`);
    recordAudit(db, {
      actorId,
      action: "integration.fix",
      target: key,
      meta: { key, file: patch.file, backupId: backup.id, shaBefore: patch.sha, shaAfter, outcome: "applied" },
    });
    log.info(`[integration] fix ${key} applied to ${patch.path} by ${actorId} (backup ${backup.id})`);
  }

  /**
   * PLAN/06 §3.7 without the lock: restart runit pm2, wait for every app that was online. `offer` false (restore +
   * restart) never offers another restore: the newest backup then holds the fixed file.
   */
  async function restartChecked(actorId: string, offer: boolean): Promise<Pm2RestartResult> {
    // Expected back: what ran before plus every runnable apps.json entry, so a site an earlier restart lost is still
    // reported as missing (QA fix-04 MAJOR-1). A hand-written app that was stopped stays out; one running but not in
    // the ecosystem (a template made by sites_dir_create) is expected and reported (QA fix-07 MAJOR-N2).
    const before = [...new Set([...(await onlinePm2Apps(ctx)), ...runnablePanelApps(ctx)])];
    const sup = await system.runit.supervise("pm2");
    const startedAt = sup?.uptimeSec === undefined ? null : Date.now() - sup.uptimeSec * MS_PER_SEC;
    if (!(await system.runit.control("pm2", "restart"))) throw new ApiError(404, "not_found", "unknown service pm2");
    deps.monitor?.noteIntentionalRestart({ kind: "service", name: "pm2" });
    recordAudit(db, { actorId, action: "service.restart", target: "pm2" });
    // ponytail: trusts the pid pm2 reports (no /proc liveness check); add one if pm2 is seen lying about pids.
    let missing = before;
    for (const end = Date.now() + poll.timeoutMs; ; await Bun.sleep(poll.intervalMs)) {
      const now = await onlinePm2Apps(ctx);
      missing = before.filter((n) => !now.includes(n));
      if (missing.length === 0 || Date.now() >= end) break;
    }
    // The newest fix is to blame when pm2 had not started since it, or when an earlier checked restart after it also
    // lost apps (QA fix-07 N3: the second restart kept the warning but lost its restore button).
    const eco = offer && missing.length > 0 ? listFixBackups(dataDir, "ecosystem")[0] : undefined;
    const fresh = eco && (startedAt === null || Date.parse(eco.at) > startedAt || lostAfter === eco.id);
    const offerRestore = eco && fresh ? eco.id : null;
    lostAfter = missing.length > 0 ? (offerRestore ?? lostAfter) : null;
    recordAudit(db, { actorId, action: "integration.pm2_restart", target: "pm2", meta: { missing: missing.length } });
    if (missing.length) log.warn(`[integration] pm2 restart by ${actorId}: ${missing.length} app(s) did not come back`);
    const after = await integration.refresh();
    const listed = new Set(after.appNames ?? []);
    const notListed = missing.filter((n) => !listed.has(n));
    return { ok: missing.length === 0, missing, offerRestore, notListed, integration: after };
  }

  return {
    /** POST /integration/fixes/:key/preview: the change and its sha, nothing written. */
    async preview(rawKey: string): Promise<FixPreview> {
      const key = fixKey(rawKey);
      const plan = await planFix(ctx, key);
      if (plan.kind === "manual")
        throw new ApiError(422, "not_fixable", `fix ${key} cannot run: ${plan.reason}`, { reason: plan.reason });
      if (plan.kind === "unchanged") return { key, files: [], effects: NO_EFFECTS };
      const p = plan.patch;
      return {
        key,
        effects: plan.effects,
        files: p ? [{ file: p.file, path: p.path, sha: p.sha, changes: p.changes }] : [],
      };
    },

    /** POST /integration/fixes/:key with `{ expect: { path: sha } }` from the preview (PLAN/06 §3.4, §6.2). */
    async apply(actorId: string, rawKey: string, body: unknown): Promise<FixResult> {
      const key = fixKey(rawKey);
      const expect = obj(obj(body).expect);
      return exclusive(async () => {
        // The probe serves apps.json to the candidate, so the file must exist before validation (D3, as verify).
        if (key === "ecosystem_block") await io("create apps.json", () => ensureAppsJson(ctx));
        const plan = await planFix(ctx, key);
        if (plan.kind === "manual")
          throw new ApiError(422, "not_fixable", `fix ${key} cannot run: ${plan.reason}`, { reason: plan.reason });
        if (plan.kind === "unchanged") return result(key, "unchanged");
        const patch = plan.patch;
        if (patch === null) {
          await createMissing(actorId, key, plan.effects);
          return result(key, "applied");
        }
        if (expect[patch.path] !== patch.sha)
          throw new ApiError(409, "changed", `${patch.path} changed since the preview`);
        const detail = await io(`validate ${patch.path}`, () => validate(patch, plan.probe));
        if (detail !== null) {
          const meta = { key, file: patch.file, shaBefore: patch.sha, outcome: "validation_failed" };
          recordAudit(db, { actorId, action: "integration.fix", target: key, meta });
          throw new ApiError(422, "validation_failed", `fix ${key} was not applied: the result does not load`, {
            detail,
          });
        }
        await write(actorId, key, patch);
        return result(key, "applied");
      });
    },

    /** POST /integration/backups/:id/restore `{ force?, restart? }` (PLAN/06 §3.5). */
    async restore(actorId: string, id: string, body: unknown): Promise<FixResult> {
      const b = obj(body);
      const force = b.force === true;
      const e = resolveFixBackup(dataDir, id);
      if (!e) throw new ApiError(404, "not_found", "no such fix backup");
      return exclusive(async () => {
        const path = fixTargetPath(ctx, e.file);
        const cur = readBytesOrNull(path);
        if (!force && (cur === null || sha256(cur).slice(0, 8) !== e.sha8))
          throw new ApiError(409, "changed_since", `${path} was edited after the fix`);
        const bytes = readFileSync(e.path);
        const mode = cur === null ? NEW_FILE_MODE[e.file] : statSync(path).mode & 0o777;
        // An apps.json backup is the unparsable file itself: putting it back is what undo means, so no check.
        const detail = await io(`validate backup ${e.id}`, () =>
          e.file === "apps_json"
            ? null
            : e.file === "ecosystem"
              ? validateEcosystem(ctx, bytes, mode, null)
              : checkRunScriptSyntax(ctx, runScriptPath(ctx), bytes, mode),
        );
        if (detail !== null) throw new ApiError(422, "validation_failed", `backup ${e.id} does not load`, { detail });
        // Undo of the undo: the current file is backed up as well (named after the bytes restored now).
        const undo =
          cur === null ? null : await io(`back up ${path}`, () => saveFixBackup(dataDir, e.file, cur, sha256(bytes)));
        await io(`write ${path}`, () => writeAtomic(path, bytes, { mode }));
        recordAudit(db, {
          actorId,
          action: "integration.restore",
          target: e.file,
          meta: { file: e.file, backupId: e.id, forced: force, undoId: undo?.id ?? null },
        });
        log.info(`[integration] ${e.file} restored from ${e.id} by ${actorId}${force ? " (forced)" : ""}`);
        if (b.restart !== true) return result("restore", "restored");
        const restart = await restartChecked(actorId, false);
        return { key: "restore", outcome: "restored", restart, integration: restart.integration };
      });
    },

    /**
     * POST /integration/pm2/restart: confirmed in the UI, checked here (PLAN/06 F10). A repeat while one runs (the
     * browser resends a POST whose connection dropped) gets that run's result instead of 409 `busy`.
     */
    restartPm2(actorId: string): Promise<Pm2RestartResult> {
      if (restarting) return restarting;
      const run = exclusive(() => restartChecked(actorId, true));
      restarting = run;
      const clear = () => {
        restarting = null;
      };
      run.then(clear, clear);
      return run;
    },
  };
}

/** The fix service instance type. */
export type IntegrationFixes = ReturnType<typeof createIntegrationFixes>;
