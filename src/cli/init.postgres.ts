// Init step 4 "postgres" (PLAN/07 §4.1 row 4): initdb only when there is no data folder, then the runit service is
// switched on. Existing data is never touched; a stopped PostgreSQL with data is only reported (the UI can start it).
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SuperviseState } from "../server/system/system.types";
import { probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { INIT_TIMING, type InitTiming, removeDown, sv } from "./init.runit";
import { defineStep, INIT_EXIT, type InitContext, type PlanLine } from "./init.types";

/** What step 4 found: `data` = PG_VERSION exists, `foreign` = data folder holds files but no PG_VERSION. */
export type PostgresState = { dir: string; data: boolean; foreign: boolean; service: SuperviseState | null };

const dataDirOf = (ctx: InitContext) => dirname(probePaths(ctx.host.paths).pgVersion);

/** Step 4 with `timing` (tests shorten the waits). */
export const createPostgresStep = (timing: InitTiming = INIT_TIMING) =>
  defineStep<PostgresState>({
    id: "postgres",
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
            text: tr(
              `Folder ${s.dir} holds files but no PostgreSQL data; left untouched`,
              `Folder ${s.dir} berisi file tetapi bukan data PostgreSQL; tidak disentuh`,
            ),
            hint: tr(
              "check what is in it; empty the folder if it is not used, then run panel init again",
              "periksa isinya; kosongkan folder itu bila tidak dipakai, lalu jalankan lagi panel init",
            ),
          },
        ];
      if (!s.data)
        return [
          {
            kind: "action",
            text: tr(
              "Setting up the PostgreSQL database (initdb) and starting it",
              "Menyiapkan database PostgreSQL (initdb) dan menyalakannya",
            ),
          },
        ];
      if (s.service?.state !== "run")
        return [
          {
            kind: "warning",
            text: tr(
              "PostgreSQL is not running (its data exists and is not changed)",
              "PostgreSQL tidak berjalan (datanya ada dan tidak diubah)",
            ),
            hint: tr(
              "open the Services page in the panel and press Start on postgres",
              "buka halaman Layanan di panel, tekan Jalankan postgres",
            ),
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
          tr(
            `initdb failed (code ${rc}); the PostgreSQL data was not created.`,
            `initdb gagal (kode ${rc}); data PostgreSQL belum dibuat.`,
          ),
          tr("see the message above", "lihat pesan di atas"),
        );
      ctx.state.changed.push(s.dir);
      if (!existsSync(join(ctx.host.paths.svdir, "postgres"))) {
        ctx.state.manual.push(
          tr(
            "The postgres service is not in runit yet; see: panel docs packages",
            "Layanan postgres belum ada di runit; lihat: panel docs packages",
          ),
        );
        return;
      }
      removeDown(ctx, "postgres");
      await sv(ctx, ["up", "postgres"], timing);
      ctx.out.check("ok", tr("PostgreSQL set up and started", "PostgreSQL disiapkan dan dinyalakan"));
    },
  });

/** Step 4 (§4.1). */
export const postgresStep = createPostgresStep();
