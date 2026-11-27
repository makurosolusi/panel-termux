// Init step 10 "start" (PLAN/07 §4.1 row 10, K9, K21, C22): switch the panel service on and check it. A running
// panel is restarted only in upgrade mode and only through confirmRisky("restart-panel"); afterwards /api/health
// must report this binary's version and runit's process must run ~/panel/panel (inode, K21). pm2 and cloudflared
// are never touched here.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SuperviseState } from "../server/system/system.types";
import { ENV_VARS } from "../shared/env.schema";
import { type PanelHealth, probePaths } from "./cli.host";
import { CliExit } from "./cli.output";
import { readEnvFile } from "./env.file";
import { SELF_VERSION, staleProcess } from "./init.mode";
import { INIT_TIMING, type InitTiming, removeDown, sv, waitFor } from "./init.runit";
import { defineStep, INIT_EXIT, INIT_STEP_TITLES, type InitContext, type PlanLine } from "./init.types";

/** `sv -w` seconds: panel shutdown waits up to 120 s for a running site change (PLAN/03 §4.12). */
export const RESTART_WAIT_SEC = 130;
const DEFAULT_PORT = Number(ENV_VARS.find((v) => v.name === "PORT")?.default);

/** What step 10 found. `health` = /api/health now (null = not answering). */
export type StartState = { service: SuperviseState | null; down: boolean; health: PanelHealth | null; stale: boolean };

const portOf = (ctx: InitContext) =>
  Number(readEnvFile(probePaths(ctx.host.paths).envFile)?.PORT?.trim() || DEFAULT_PORT);
const running = (s: StartState) => s.service?.state === "run";

/** `panel <sub>` spelled like the resume command (m8). */
const panelCmd = (ctx: InitContext, sub: string) => ctx.resumeCommand().replace(/ init$/, ` ${sub}`);

/** Waits for /api/health = this version, then checks runit runs ~/panel/panel; else exit 1 (+ rollback hint). */
async function checkHealth(ctx: InitContext, timing: InitTiming): Promise<void> {
  let last: PanelHealth | null = null;
  const port = portOf(ctx);
  const ok = await waitFor(
    async () => {
      last = await ctx.host.health(port);
      return last?.version === SELF_VERSION;
    },
    timing.healthMs,
    timing.pollMs,
  );
  const log = join(ctx.host.paths.logdir, "sv", "panel", "current");
  const hint = existsSync(probePaths(ctx.host.paths).prev)
    ? `untuk kembali ke versi sebelumnya: ${panelCmd(ctx, "rollback")} (tambah --db bila database sudah dimigrasi)`
    : `periksa: ${panelCmd(ctx, "doctor")}`;
  const seen = last as PanelHealth | null;
  if (!ok)
    throw new CliExit(
      INIT_EXIT.failed,
      seen
        ? `Panel yang menjawab masih v${seen.version}, bukan v${SELF_VERSION}. Lihat ${log}.`
        : `Panel belum menjawab di port ${port} setelah ${Math.round(timing.healthMs / 1000)} dtk. Lihat ${log}.`,
      hint,
    );
  if (staleProcess(ctx.host))
    throw new CliExit(
      INIT_EXIT.failed,
      `Layanan panel masih menjalankan file lama, bukan ${probePaths(ctx.host.paths).binary}.`,
      hint,
    );
  ctx.out.check("ok", `Panel v${SELF_VERSION} berjalan dan sehat`);
}

/** Step 10 with `timing` (tests shorten the waits). */
export const createStartStep = (timing: InitTiming = INIT_TIMING) =>
  defineStep<StartState>({
    id: "start",
    title: INIT_STEP_TITLES.start,
    async detect(ctx) {
      return {
        service: await ctx.host.system().runit.supervise("panel"),
        down: existsSync(join(ctx.host.paths.svdir, "panel", "down")),
        health: await ctx.host.health(portOf(ctx)),
        stale: staleProcess(ctx.host),
      };
    },
    plan(ctx, s): PlanLine[] {
      if (ctx.mode === "upgrade" && running(s))
        return [
          {
            kind: "action",
            text: "Memulai ulang layanan panel (situs dan pm2 tidak disentuh; snapshot database dibuat panel saat start)",
          },
        ];
      if (!running(s)) return [{ kind: "action", text: "Menyalakan panel dan memeriksanya" }];
      if (s.down) return [{ kind: "action", text: "Membuat panel menyala otomatis setelah HP hidup" }];
      if (s.health?.version !== SELF_VERSION || s.stale)
        return [
          {
            kind: "warning",
            text: "Panel berjalan tetapi belum sehat; tidak dimulai ulang",
            hint: `periksa: ${panelCmd(ctx, "doctor")}`,
          },
        ];
      return [];
    },
    async apply(ctx, s) {
      removeDown(ctx, "panel");
      if (!running(s)) await sv(ctx, ["up", "panel"], timing);
      else if (ctx.mode === "upgrade") {
        const manual = `SVDIR=${ctx.host.paths.svdir} sv -w ${RESTART_WAIT_SEC} restart panel`;
        const go = await ctx.confirmRisky("restart-panel", "Mulai ulang panel sekarang?", manual);
        if (!go) {
          ctx.state.manual.push(`Mulai ulang panel agar versi baru dipakai: ${manual}`);
          return;
        }
        ctx.out.line(
          "Memulai ulang panel. Bila ada perubahan situs yang sedang berjalan, panel menunggu sampai 2 menit.",
        );
        // Once, no retry (a retried restart would restart twice); the health check below judges the result.
        await ctx.host.exec("sv", ["-w", String(RESTART_WAIT_SEC), "restart", "panel"], {
          timeoutMs: (RESTART_WAIT_SEC + 10) * 1000,
        });
      }
      // repair/fresh with the panel already running: only `down` was removed, never a restart (C22)
      await checkHealth(ctx, timing);
    },
  });

/** Step 10 (§4.1). */
export const startStep = createStartStep();
