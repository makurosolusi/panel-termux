// Init step 3 "runit" (PLAN/07 §4.1 row 3, K11b, m4, m5, lab L1) plus the runit helpers steps 4, 6, 7 and 10 share:
// waiting, `sv` with retry until runsv supervises the folder, and service folders built under a dot name + rename.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileSynced } from "../server/sites/site.files";
import { type CliHost, probePaths } from "./cli.host";
import { CliExit } from "./cli.output";
import { defineStep, INIT_EXIT, INIT_STEP_TITLES, type InitContext } from "./init.types";

/** Waits of the service steps; tests pass small values. */
export type InitTiming = {
  /** runsvdir pidfile after `service-daemon start` (§4.1 row 3: ≤ 15 s). */
  daemonMs: number;
  /** `sv` retried until runsv supervises a new folder (runsvdir rescans every ~5 s). */
  svMs: number;
  /** /api/health after start/restart (§4.1 row 10: ≤ 30 s). */
  healthMs: number;
  pollMs: number;
};
/** Production waits. */
export const INIT_TIMING: InitTiming = { daemonMs: 15_000, svMs: 15_000, healthMs: 30_000, pollMs: 500 };

/** Polls `check` until true or `ms` passed; returns the last answer. */
export async function waitFor(check: () => boolean | Promise<boolean>, ms: number, pollMs: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= end) return false;
    await Bun.sleep(pollMs);
  }
}

/** runsvdir is alive: its service-daemon pidfile names a live pid. */
export function daemonAlive(host: CliHost): boolean {
  const file = probePaths(host.paths).daemonPid;
  if (!existsSync(file)) return false;
  const pid = Number(readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 && host.proc.alive(pid);
}

/**
 * `sv <args>` (SVDIR/LOGDIR explicit through CliHost.exec), retried while runsv does not supervise the folder yet;
 * still failing after `t.svMs` → exit 1 with sv's own message (never secret: sv prints service paths only).
 */
export async function sv(ctx: InitContext, args: string[], t: InitTiming, timeoutMs?: number): Promise<void> {
  let last = "";
  const ok = await waitFor(
    async () => {
      const r = await ctx.host.exec("sv", args, timeoutMs ? { timeoutMs } : {});
      last = `kode ${r.code}${r.stdout || r.stderr ? `: ${(r.stdout + r.stderr).trim().slice(0, 200)}` : ""}`;
      return r.code === 0;
    },
    t.svMs,
    t.pollMs,
  );
  if (!ok)
    throw new CliExit(
      INIT_EXIT.failed,
      `Perintah sv ${args.join(" ")} gagal (${last}).`,
      `pastikan runit berjalan, lalu jalankan lagi: ${ctx.resumeCommand()}`,
    );
}

/** Removes `<svdir>/<name>/down` when present (recorded); the service then also starts after a reboot. */
export function removeDown(ctx: InitContext, name: string): void {
  const down = join(ctx.host.paths.svdir, name, "down");
  if (!existsSync(down)) return;
  rmSync(down, { force: true });
  ctx.state.changed.push(down);
}

/** termux-services' logger; `log/run` of our services links to it (output lands in $LOGDIR/sv/<name>/current). */
export const svloggerPath = (host: CliHost) => join(host.paths.prefix, "share", "termux-services", "svlogger");

/**
 * Builds `<svdir>/.<name>.new` (run 755, log/run → svlogger, optional `down`) and renames it to `<svdir>/<name>`,
 * so runsvdir (which skips dot names) never sees a half-built folder (§4.2). The target must not exist.
 */
export function installServiceDir(ctx: InitContext, name: string, run: string, down: boolean): void {
  const svdir = ctx.host.paths.svdir;
  const target = join(svdir, name);
  const tmp = join(svdir, `.${name}.new`);
  try {
    rmSync(tmp, { recursive: true, force: true }); // left over by an interrupted run
    mkdirSync(join(tmp, "log"), { recursive: true });
    writeFileSynced(join(tmp, "run"), run, 0o755);
    symlinkSync(svloggerPath(ctx.host), join(tmp, "log", "run"));
    if (down) writeFileSync(join(tmp, "down"), "");
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error(`install runit service ${target}: ${(e as Error).message}`, { cause: e });
  }
  ctx.state.changed.push(target);
}

/** What step 3 found. */
export type RunitState = { alive: boolean };

/** Step 3 with `timing` (tests shorten the waits). */
export const createRunitStep = (timing: InitTiming = INIT_TIMING) =>
  defineStep<RunitState>({
    id: "runit",
    title: INIT_STEP_TITLES.runit,
    detect: async (ctx) => ({ alive: daemonAlive(ctx.host) }),
    plan: (_ctx, s) => (s.alive ? [] : [{ kind: "action", text: "Menyalakan runit (pengelola layanan Termux)" }]),
    async apply(ctx) {
      // stdio ignore + CliHost's clean env (K11b): runsvdir and every service inherit no ENV_VARS key; SVDIR/LOGDIR
      // explicit because a non-login ssh session has neither (m4, lab A). Exit 1 with runsvdir alive = ok (m5).
      const rc = await ctx.host.run("service-daemon", ["start"], { stdio: "ignore" });
      if (!(await waitFor(() => daemonAlive(ctx.host), timing.daemonMs, timing.pollMs)))
        throw new CliExit(
          INIT_EXIT.needsUser,
          `runit belum menyala (service-daemon start kode ${rc}).`,
          `tutup dan buka lagi Termux, lalu jalankan: ${ctx.resumeCommand()}`,
        );
      ctx.out.check("ok", "runit berjalan");
    },
  });

/** Step 3 (§4.1). */
export const runitStep = createRunitStep();
