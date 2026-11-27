// cloudflared runit service for `panel init` step 8 (PLAN/07 §4.4 point 5, lab L2 option A): OUR run script
// (`--no-autoupdate`, HOME exported, no token file) + no `down` + apt-mark hold. An existing run script that is not
// the package template is left alone (K6); a restart of a running cloudflared only via confirmRisky (K9).
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { TermuxExecError } from "../server/exec/termux.exec";
import { writeAtomic } from "../server/sites/site.files";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { INIT_EXIT, type InitContext, type PlanLine } from "./init.types";

/** runit service name of the tunnel (same as the site jobs' CLOUDFLARED_SERVICE). */
export const CF_SERVICE = "cloudflared";
/** Marker of the package's run script template (lab L2: `tunnel run --token-file`), as doctor reads it. */
const TEMPLATE_MARK = "--token-file";
/** Tunnel names/UUIDs we put into the run script: no shell metacharacters. */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** What the service part needs to know; read-only detect. */
export type ServiceState = {
  /** Contents of $SVDIR/cloudflared/run; null = missing. */
  run: string | null;
  dirExists: boolean;
  down: boolean;
  /** dpkg says cloudflared is installed (hold only makes sense then). */
  installed: boolean;
  held: boolean;
  running: boolean;
};

const svDir = (ctx: InitContext) => join(ctx.host.paths.svdir, CF_SERVICE);

/** Our run script (server-termux pattern, PLAN/07 §4.4 point 5). `ref` = tunnel name or UUID. */
export function cloudflaredRunScript(prefix: string, home: string, ref: string): string {
  if (!SAFE_REF.test(ref)) throw new Error(`tunnel name ${JSON.stringify(ref)} is not safe for a run script`);
  return `#!${prefix}/bin/sh
# panel init: tunnel ${ref}, routes from ~/.cloudflared/config.yml (PLAN/07 §4.4, lab L2 option A).
export HOME=${home}
exec cloudflared tunnel --no-autoupdate run ${ref} 2>&1
`;
}

const isTemplate = (run: string | null) => run?.includes(TEMPLATE_MARK) === true;

/** Reads the service folder, dpkg/apt-mark (read-only probes) and the runsv state. */
export async function detectService(ctx: InitContext): Promise<ServiceState> {
  const dir = svDir(ctx);
  const runFile = join(dir, "run");
  const probe = async (tool: string, args: string[]) => {
    try {
      return await ctx.host.exec(tool, args, { lcAllC: true });
    } catch (e) {
      if (e instanceof TermuxExecError) return null; // tool missing on a bare Termux: the package step installs it
      throw e;
    }
  };
  const dpkg = await probe("dpkg", ["-s", CF_SERVICE]);
  const holds = await probe("apt-mark", ["showhold"]);
  const sup = await ctx.host.system().runit.supervise(CF_SERVICE);
  return {
    run: existsSync(runFile) ? readFileSync(runFile, "utf8") : null,
    dirExists: existsSync(dir),
    down: existsSync(join(dir, "down")),
    installed: dpkg?.code === 0 && /^Status: .* installed$/m.test(dpkg.stdout),
    held: holds?.stdout.split("\n").includes(CF_SERVICE) ?? false,
    running: sup?.state === "run",
  };
}

/** Plan lines of the service part (none when it is already ours/custom, enabled, held and running). */
export function planService(ctx: InitContext, s: ServiceState): PlanLine[] {
  const lines: PlanLine[] = [];
  if (s.run === null || isTemplate(s.run) || s.down || !s.running)
    lines.push({
      kind: "action",
      text: tr(
        "Starting the cloudflared service (also by itself after the phone turns on)",
        "Menyalakan layanan cloudflared (juga otomatis setelah HP menyala)",
      ),
    });
  if (s.installed && !s.held)
    lines.push({
      kind: "action",
      text: tr(
        "Holding cloudflared back from automatic upgrades (apt-mark hold; panel docs packages)",
        "Menahan cloudflared dari upgrade otomatis (apt-mark hold; panel docs packages)",
      ),
    });
  if (isTemplate(s.run) && ctx.mode !== "fresh" && !ctx.tty)
    lines.push({
      kind: "warning",
      text: tr(
        "The cloudflared run script is still the package template; replaced only after a question in a terminal",
        "Run script cloudflared masih template paket; diganti hanya setelah ditanya di terminal",
      ),
      hint: tr(`run ${ctx.resumeCommand()} again in a terminal`, `jalankan lagi ${ctx.resumeCommand()} di terminal`),
    });
  return lines;
}

/**
 * No terminal, and applyService would have to restart a running cloudflared (config.yml changes this run, or its
 * run script is replaced): confirmRisky cannot ask, so the step must stop before it changes anything (K9).
 */
export function restartNeedsTerminal(ctx: InitContext, s: ServiceState, ingressChanges: boolean): boolean {
  if (ctx.tty || !s.running || !s.dirExists) return false;
  return ingressChanges || s.run === null || (isTemplate(s.run) && ctx.mode === "fresh");
}

const fail = (what: string, code: number) =>
  new CliExit(
    INIT_EXIT.failed,
    tr(`${what} failed (code ${code}).`, `${what} gagal (kode ${code}).`),
    tr("see: sv status cloudflared; panel docs cloudflare", "lihat: sv status cloudflared; panel docs cloudflare"),
  );

/** New service folder built under a dot name, then renamed (runsvdir never sees half a folder). */
function createServiceDir(ctx: InitContext, script: string): void {
  const dir = svDir(ctx);
  const tmp = join(ctx.host.paths.svdir, `.${CF_SERVICE}.new`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, "log"), { recursive: true });
  writeAtomic(join(tmp, "run"), script, { mode: 0o700 });
  symlinkSync(join(ctx.host.paths.prefix, "share", "termux-services", "svlogger"), join(tmp, "log", "run"));
  renameSync(tmp, dir);
  ctx.state.changed.push(dir);
}

/**
 * Brings the service to: our run script (only where allowed), no `down`, held, running. `ref` = tunnel of config.yml;
 * `ingressChanged` = config.yml changed this run, so a running cloudflared needs a restart (K9).
 */
export async function applyService(ctx: InitContext, s: ServiceState, ref: string, ingressChanged: boolean) {
  const script = cloudflaredRunScript(ctx.host.paths.prefix, ctx.host.paths.home, ref);
  const dir = svDir(ctx);
  let scriptChanged = false;
  if (!s.dirExists) {
    createServiceDir(ctx, script); // no `down` in it: runsvdir starts it on its next scan
    scriptChanged = true;
  } else if (s.run === null || isTemplate(s.run)) {
    const replace =
      s.run === null ||
      ctx.mode === "fresh" ||
      (ctx.tty &&
        (await ctx.prompt.confirm(
          tr(
            "The cloudflared run script is still the package template (--token-file, no --no-autoupdate). Replace it with the panel's run script?",
            "Run script cloudflared masih template paket (--token-file, tanpa --no-autoupdate). Ganti dengan run script panel?",
          ),
          true,
        )));
    if (replace) {
      writeAtomic(join(dir, "run"), script, { mode: 0o700 });
      ctx.state.changed.push(join(dir, "run"));
      scriptChanged = true;
    } else
      ctx.state.manual.push(
        tr(
          "The cloudflared run script is still the package template: see panel docs packages",
          "Run script cloudflared masih template paket: lihat panel docs packages",
        ),
      );
  }
  if (s.down) {
    rmSync(join(dir, "down"), { force: true });
    ctx.state.changed.push(join(dir, "down"));
  }
  if (s.installed && !s.held) {
    const r = await ctx.host.exec("apt-mark", ["hold", CF_SERVICE], { lcAllC: true });
    if (r.code !== 0) throw fail("apt-mark hold cloudflared", r.code);
  }
  if (!s.dirExists) return;
  if (!s.running) {
    const r = await ctx.host.exec("sv", ["up", CF_SERVICE]);
    if (r.code !== 0) throw fail("sv up cloudflared", r.code);
    return;
  }
  if (!ingressChanged && !scriptChanged) return;
  const restart = await ctx.confirmRisky(
    "restart-cloudflared",
    tr(
      "Restart cloudflared so the tunnel changes apply? Every site drops for a few seconds.",
      "Mulai ulang cloudflared supaya perubahan tunnel dipakai? Semua situs putus beberapa detik.",
    ),
    "sv restart cloudflared",
  );
  if (!restart) {
    ctx.state.manual.push(
      tr(
        "The tunnel changes apply after: sv restart cloudflared",
        "Perubahan tunnel dipakai setelah: sv restart cloudflared",
      ),
    );
    return;
  }
  const r = await ctx.host.exec("sv", ["restart", CF_SERVICE]);
  if (r.code !== 0) throw fail("sv restart cloudflared", r.code);
}
