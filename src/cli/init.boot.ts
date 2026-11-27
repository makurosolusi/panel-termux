// Init step 9 "boot" (PLAN/07 §4.1 row 9, m4, m11): a Termux:Boot script that keeps Termux awake and starts runit
// (every service) after the phone powers on, then `termux-wake-lock` now (Android asks about the battery). A boot
// script that already starts the services (POCO: start-services) means nothing is written.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { TermuxExecError } from "../server/exec/termux.exec";
import { writeAtomic } from "../server/sites/site.files";
import { type CliHost, type CliPaths, probePaths } from "./cli.host";
import { ANDROID_APPS } from "./doctor.probe";
import { defineStep, INIT_STEP_TITLES, type PlanLine } from "./init.types";

/** File name init writes under ~/.termux/boot. */
export const BOOT_SCRIPT = "panel-termux";
// Same rule as doctor's termux_boot_script check (doctor.probe.ts BOOT_STARTS_SERVICES, not exported there).
const STARTS_SERVICES = /service-daemon|ensure-services|start-services/;
const CMD = "/system/bin/cmd";
const CMD_TIMEOUT_MS = 5000;
const INSTALL_BOOT = "Pasang aplikasi Termux:Boot dari sumber yang sama dengan Termux (F-Droid), lalu buka sekali";

/** Boot script text: absolute tool paths (Termux:Boot starts it with a bare environment), SVDIR + LOGDIR (m4). */
export const bootScript = (p: CliPaths) =>
  `#!${p.prefix}/bin/sh
# Ditulis oleh panel init: saat HP menyala, Termux dijaga tetap hidup dan runit menyalakan semua layanan.
${p.prefix}/bin/termux-wake-lock
export SVDIR="${p.svdir}" LOGDIR="${p.logdir}"
exec ${p.prefix}/bin/service-daemon start
`;

/** What step 9 found: boot scripts that start the services, and whether the Termux:Boot app is installed (null = unknown). */
export type BootState = { starters: string[]; app: boolean | null };

async function bootApp(host: CliHost): Promise<boolean | null> {
  try {
    const r = await host.exec(CMD, ["package", "list", "packages", ANDROID_APPS.boot], { timeoutMs: CMD_TIMEOUT_MS });
    return r.code === 0 ? r.stdout.split("\n").some((l) => l.trim() === `package:${ANDROID_APPS.boot}`) : null;
  } catch (e) {
    if (e instanceof TermuxExecError) return null; // no `cmd` / timeout: unknown, doctor says the same
    throw e;
  }
}

function starters(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .filter((n) => statSync(join(dir, n)).isFile() && STARTS_SERVICES.test(readFileSync(join(dir, n), "utf8")));
}

/** Step 9 (§4.1). */
export const bootStep = defineStep<BootState>({
  id: "boot",
  title: INIT_STEP_TITLES.boot,
  detect: async (ctx) => ({ starters: starters(probePaths(ctx.host.paths).bootDir), app: await bootApp(ctx.host) }),
  plan(_ctx, s) {
    const lines: PlanLine[] = [];
    if (s.starters.length === 0)
      lines.push({
        kind: "action",
        text: "Menyalakan semua otomatis setelah HP menyala (Termux:Boot); HP akan menanyakan izin baterai: pilih Izinkan",
      });
    if (s.app === false)
      lines.push({ kind: "warning", text: "Aplikasi Termux:Boot belum terpasang", hint: "lihat: panel docs android" });
    return lines;
  },
  async apply(ctx, s) {
    const dir = probePaths(ctx.host.paths).bootDir;
    const file = join(dir, BOOT_SCRIPT);
    mkdirSync(dir, { recursive: true });
    writeAtomic(file, bootScript(ctx.host.paths), { mode: 0o755 });
    ctx.state.changed.push(file);
    ctx.out.line("HP akan menanyakan izin baterai untuk Termux: pilih Izinkan.");
    const rc = await ctx.host.run("termux-wake-lock", [], { stdio: "ignore" });
    if (rc !== 0) ctx.out.check("warning", `termux-wake-lock gagal (kode ${rc})`, "lihat: panel docs android");
    if (s.app === false) ctx.state.manual.push(INSTALL_BOOT);
    // Battery optimisation is an Android setting init cannot change (m11); said once, on a new phone.
    if (ctx.mode === "fresh")
      ctx.state.manual.push(
        "Matikan pembatasan baterai untuk Termux dan Termux:Boot (Pengaturan → Aplikasi → Termux → Baterai → Tidak dibatasi); panduan: panel docs android",
      );
  },
});
