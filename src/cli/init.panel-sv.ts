// Init step 6 "panel-sv" (PLAN/07 §4.1 row 6, E18, C23): the panel's runit folder from the embedded
// deploy/sv/panel/run. An existing run script is replaced only when it is a known old template (kept as
// run.bak-<version>, also in upgrade mode); a custom one only gets a warning.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error TS2307: Bun embeds the shipped run script as text (`type: "text"`); tsc has no module for it.
import PANEL_RUN from "../../deploy/sv/panel/run" with { type: "text" };
import { writeAtomic } from "../server/sites/site.files";
import { tr } from "./cli.locale";
import { installServiceDir } from "./init.runit";
import { defineStep, type InitContext, type PlanLine } from "./init.types";

/** Current template (embedded at build). */
export const PANEL_RUN_TEMPLATE = PANEL_RUN as string;

/**
 * md5 of earlier shipped deploy/sv/panel/run versions → version label used in `run.bak-<label>` (E18). A release
 * that changes the template adds the previous template's md5 here (`git show <tag>:deploy/sv/panel/run | md5`).
 */
export const OLD_PANEL_RUN_MD5: Readonly<Record<string, string>> = {
  "17778486c486a7ba2f48f02e78d08f1f": "0.5.0", // 0.3.0, 0.4.0, 0.5.0 (install-phone.sh; sha256 6587514f…), what POCO runs
};

/** md5 hex of `data`. */
export const md5 = (data: string | Uint8Array) => new Bun.CryptoHasher("md5").update(data).digest("hex");

/** What step 6 found: no folder, our current run script, a known old one (`oldVersion`), or anything else. */
export type PanelSvState = {
  dir: string;
  kind: "missing" | "current" | "old" | "custom";
  oldVersion?: string;
};

/** Reads `$SVDIR/panel/run` and classifies it. */
export function classifyPanelRun(ctx: InitContext): PanelSvState {
  const dir = join(ctx.host.paths.svdir, "panel");
  const run = join(dir, "run");
  if (!existsSync(dir)) return { dir, kind: "missing" };
  if (!existsSync(run)) return { dir, kind: "custom" };
  const bytes = readFileSync(run);
  if (bytes.equals(Buffer.from(PANEL_RUN_TEMPLATE))) return { dir, kind: "current" };
  const oldVersion = OLD_PANEL_RUN_MD5[md5(bytes)];
  return oldVersion ? { dir, kind: "old", oldVersion } : { dir, kind: "custom" };
}

/** Step 6 (§4.1). */
export const panelSvStep = defineStep<PanelSvState>({
  id: "panel-sv",
  detect: async (ctx) => classifyPanelRun(ctx),
  plan(ctx, s): PlanLine[] {
    const run = join(s.dir, "run");
    if (s.kind === "old")
      return [
        {
          kind: "action",
          text: tr(
            `Updating the panel service run script (the old one is kept as run.bak-${s.oldVersion})`,
            `Memperbarui run script layanan panel (yang lama disimpan sebagai run.bak-${s.oldVersion})`,
          ),
        },
      ];
    if (s.kind === "custom")
      return [
        {
          kind: "warning",
          text: tr(
            `The panel service run script (${run}) was not made by the panel; left unchanged`,
            `Run script layanan panel (${run}) bukan buatan panel; tidak diubah`,
          ),
          hint: tr(
            `if the panel does not start, move the folder ${s.dir} away and run panel init again`,
            `bila panel tidak menyala, pindahkan folder ${s.dir} lalu jalankan lagi panel init`,
          ),
        },
      ];
    if (s.kind === "current") return [];
    // C23: upgrade mode only refreshes a known old run script; a missing service is reported for the next run.
    if (ctx.mode === "upgrade")
      return [
        {
          kind: "warning",
          text: tr("The panel service is not installed in runit yet", "Layanan panel belum dipasang di runit"),
        },
      ];
    return [
      {
        kind: "action",
        text: tr(
          "Installing the panel service in runit (starts by itself after the phone turns on)",
          "Memasang layanan panel di runit (menyala otomatis setelah HP hidup)",
        ),
      },
    ];
  },
  async apply(ctx, s) {
    if (s.kind === "missing") {
      // `down` until step 10 checked .env and starts it, so runsv never starts a half-configured panel.
      installServiceDir(ctx, "panel", PANEL_RUN_TEMPLATE, true);
      return;
    }
    const run = join(s.dir, "run");
    const bak = `${run}.bak-${s.oldVersion}`;
    writeAtomic(bak, readFileSync(run), { mode: 0o755 });
    writeAtomic(run, PANEL_RUN_TEMPLATE, { mode: 0o755 });
    ctx.state.changed.push(run, bak);
    ctx.out.check(
      "ok",
      tr(
        `Panel service run script updated; the old one: ${bak}`,
        `Run script layanan panel diperbarui; yang lama: ${bak}`,
      ),
    );
  },
});
