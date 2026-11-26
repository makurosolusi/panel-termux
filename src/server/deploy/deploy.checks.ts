// Preflight checks of the deploy API (PLAN/03 §3.4 error table), thrown as ApiError before any job starts.
import { existsSync, statSync } from "node:fs";
import type { ScriptRuntime, SiteRuntime } from "../../shared/site.types";
import { ApiError } from "../routes/http.error";
import { Pm2UnavailableError, type SystemAdapters } from "../system/system.types";
import { appName, type SiteRow } from "./deploy.steps";
import { scriptRuntimeOf } from "./run.script";

/** Free space kept on the site's filesystem when app.new has to be copied there from another filesystem. */
const SITE_SPACE_MARGIN = 100 * 1000 * 1000;

/**
 * Asks pm2 (409 `pm2_not_running` when down) and returns what an adopted site's hand-written entry runs;
 * null for managed sites (the panel writes `run` itself) or when pm2 does not list the app.
 */
export async function scriptRuntime(system: SystemAdapters, s: SiteRow): Promise<ScriptRuntime | null> {
  try {
    const procs = await system.pm2.procs();
    if (s.managed) return null;
    const p = procs.find((a) => a.name === appName(s));
    return p ? scriptRuntimeOf(p) : null;
  } catch (e) {
    if (e instanceof Pm2UnavailableError) throw new ApiError(409, "pm2_not_running", e.message);
    throw e;
  }
}

/** 409 `runtime_mismatch {expected, got}` when the entry runs native/grun and the binary needs the other. */
export function assertRuntime(expected: ScriptRuntime | null, got: SiteRuntime): void {
  if ((expected === "native" || expected === "grun") && expected !== got) {
    throw new ApiError(409, "runtime_mismatch", `the pm2 entry runs a ${expected} binary, this one is ${got}`, {
      expected,
      got,
    });
  }
}

/** 409 `integration_required {failing}` for a managed site's first deploy while integration checks fail. */
export async function assertIntegration(s: SiteRow, failing: (() => Promise<string[]>) | undefined): Promise<void> {
  if (!s.managed || existsSync(`${s.dir}/app`) || !failing) return;
  const keys = await failing();
  if (keys.length) throw new ApiError(409, "integration_required", "pm2 integration is not ready", { failing: keys });
}

/** 507 `no_space` when app.new must be copied to another filesystem without size + 100 MB free there. */
export function assertSiteSpace(s: SiteRow, upload: string, sizeBytes: number, free: (p: string) => number): void {
  if (!existsSync(s.dir) || statSync(s.dir).dev === statSync(upload).dev) return;
  const needBytes = sizeBytes + SITE_SPACE_MARGIN;
  const freeNow = free(s.dir);
  if (freeNow < needBytes) {
    throw new ApiError(507, "no_space", `need ${needBytes} free bytes in ${s.dir}, have ${freeNow}`, {
      needBytes,
      freeBytes: freeNow,
    });
  }
}
