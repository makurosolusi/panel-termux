// Init step 4 "postgres" (PLAN/07 §4.1 row 4): initdb only when there is no data folder, then the runit service is
// switched on. Existing data is never touched; a stopped PostgreSQL with data is only reported (the UI can start it).
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SuperviseState } from "../server/system/system.types";
import { probePaths } from "./cli.host";
import { CliExit } from "./cli.output";
import { INIT_TIMING, type InitTiming, removeDown, sv } from "./init.runit";
import { defineStep, INIT_EXIT, INIT_STEP_TITLES, type InitContext, type PlanLine } from "./init.types";

/** What step 4 found: `data` = PG_VERSION exists, `foreign` = data folder holds files but no PG_VERSION. */
export type PostgresState = { dir: string; data: boolean; foreign: boolean; service: SuperviseState | null };

const dataDirOf = (ctx: InitContext) => dirname(probePaths(ctx.host.paths).pgVersion);

/** Step 4 with `timing` (tests shorten the waits). */
export const createPostgresStep = (timing: InitTiming = INIT_TIMING) =>
  defineStep<PostgresState>({
    id: "postgres",
    title: INIT_STEP_TITLES.postgres,
    async detect(ctx) {
      const dir = dataDirOf(ctx);
      const data = existsSync(join(dir, "PG_VERSION"));
      const foreign = !data && existsSync(dir) && readdirSync(dir).length > 0;
      return { dir, data, foreign, service: await ctx.host.system().runit.supervise("postgres") };
    },
    plan(_ctx, s): PlanLine[] {
      if (s.foreign)
        return [
          {
            kind: "error",
            text: `Folder ${s.dir} berisi file tetapi bukan data PostgreSQL; tidak disentuh`,
            hint: "periksa isinya; kosongkan folder itu bila tidak dipakai, lalu jalankan lagi panel init",
          },
        ];
      if (!s.data) return [{ kind: "action", text: "Menyiapkan database PostgreSQL (initdb) dan menyalakannya" }];
      if (s.service?.state !== "run")
        return [
          {
            kind: "warning",
            text: "PostgreSQL tidak berjalan (datanya ada dan tidak diubah)",
            hint: "buka halaman Layanan di panel, tekan Jalankan postgres",
          },
        ];
      return [];
    },
    async apply(ctx, s) {
      const rc = await ctx.host.run("initdb", [
        "-D",
        s.dir,
        "-U",
        "postgres",
        "--auth-local=trust",
        "--auth-host=scram-sha-256",
      ]);
      if (rc !== 0)
        throw new CliExit(
          INIT_EXIT.failed,
          `initdb gagal (kode ${rc}); data PostgreSQL belum dibuat.`,
          "lihat pesan di atas",
        );
      ctx.state.changed.push(s.dir);
      if (!existsSync(join(ctx.host.paths.svdir, "postgres"))) {
        ctx.state.manual.push("Layanan postgres belum ada di runit; lihat: panel docs paket");
        return;
      }
      removeDown(ctx, "postgres");
      await sv(ctx, ["up", "postgres"], timing);
      ctx.out.check("ok", "PostgreSQL disiapkan dan dinyalakan");
    },
  });

/** Step 4 (§4.1). */
export const postgresStep = createPostgresStep();
