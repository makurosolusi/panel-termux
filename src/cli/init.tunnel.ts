// `panel init` step 8, tunnel (PLAN/07 §4.4, C19, D4, D10, K9, K10): Cloudflare login → tunnel (reused when its
// credentials are here; init.tunnel.login.ts) → DNS (a record of another tunnel moves only after a TTY yes) →
// config.yml → ingress for the panel hostname → cloudflared service (init.tunnel.service.ts). Every question that
// needs a terminal comes before the first write, so a run without one stops (exit 3) with the phone unchanged.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readTunnelId } from "../server/sites/ingress.editor";
import { HOSTNAME_RE } from "../shared/address.rules";
import { ENV_VARS, type EnvVar } from "../shared/env.schema";
import { probePaths } from "./cli.host";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import { readEnvFile } from "./env.file";
import { stepRuns } from "./init.plan";
import { addIngress, routeDns, writeConfig } from "./init.tunnel.config";
import { ensureTunnel, login } from "./init.tunnel.login";
import {
  applyService,
  detectService,
  planService,
  restartNeedsTerminal,
  type ServiceState,
} from "./init.tunnel.service";
import { defineStep, INIT_EXIT, type InitContext, type PlanLine } from "./init.types";

export { defaultTunnelName } from "./init.tunnel.login";

/** Read-only facts of step 8. host = from APP_BASE_URL (https) or --hostname, null until step 5 wrote it. */
export type TunnelStepState = {
  host: string | null;
  port: number;
  cfDir: string;
  cert: boolean;
  config: string | null; // config.yml text, null = missing
  configProblem: string | null; // unreadable / no tunnel: fixed by hand, never overwritten
  ref: string | null; // `tunnel:` of config.yml (name or UUID)
  id: string | null; // tunnel UUID
  ingress: boolean; // the panel hostname has an ingress rule
  panelRunning: boolean; // runit's panel is `run`: an existing config.yml is not edited (D10, K6)
  service: ServiceState;
};

const DEFAULT_PORT = (ENV_VARS as readonly EnvVar[]).find((v) => v.name === "PORT")?.default ?? "";

function panelHost(ctx: InitContext, appBaseUrl: string | undefined): string | null {
  try {
    const u = new URL(appBaseUrl ?? "");
    if (u.protocol === "https:" && HOSTNAME_RE.test(u.hostname)) return u.hostname;
  } catch {
    // not a URL (empty/placeholder): fall back to --hostname
  }
  const flag = ctx.args.hostname?.toLowerCase() ?? null;
  return flag && HOSTNAME_RE.test(flag) ? flag : null;
}

async function detect(ctx: InitContext): Promise<TunnelStepState> {
  const p = probePaths(ctx.host.paths);
  const env = readEnvFile(p.envFile) ?? {};
  const host = panelHost(ctx, env.APP_BASE_URL);
  const configFile = join(p.cloudflaredDir, "config.yml");
  const config = existsSync(configFile) ? readFileSync(configFile, "utf8") : null;
  let configProblem: string | null = null;
  let id: string | null = null;
  let ref: string | null = null;
  let ingress = false;
  if (config !== null) {
    try {
      id = readTunnelId(config);
      const doc = Bun.YAML.parse(config) as { tunnel?: unknown; ingress?: { hostname?: unknown }[] };
      ref = typeof doc.tunnel === "string" ? doc.tunnel.trim() : null;
      ingress = host !== null && (doc.ingress ?? []).some((r) => r?.hostname === host);
      if (id === null || !ref)
        configProblem = tr(
          "~/.cloudflared/config.yml does not name a tunnel",
          "~/.cloudflared/config.yml tidak menyebut tunnel",
        );
    } catch (e) {
      const why = (e as Error).message;
      configProblem = tr(
        `~/.cloudflared/config.yml cannot be read (${why})`,
        `~/.cloudflared/config.yml tidak bisa dibaca (${why})`,
      );
    }
  }
  const panel = await ctx.host.system().runit.supervise("panel");
  return {
    host,
    port: Number(env.PORT || DEFAULT_PORT),
    cfDir: p.cloudflaredDir,
    cert: existsSync(join(p.cloudflaredDir, "cert.pem")),
    config,
    configProblem,
    ref,
    id,
    ingress,
    panelRunning: panel?.state === "run",
    service: await detectService(ctx),
  };
}

/** config.yml gets the panel rule this run: a new config, or an existing one while the panel is down (D10, K6). */
const ingressWillChange = (s: TunnelStepState) =>
  s.host !== null && !s.ingress && (s.config === null || !s.panelRunning);

const needsTerminal = (ctx: InitContext) =>
  tr(`run ${ctx.resumeCommand()} in a terminal`, `jalankan ${ctx.resumeCommand()} di terminal`);
const loginHint = (ctx: InitContext) =>
  tr(
    `run in a terminal: cloudflared tunnel login, then ${ctx.resumeCommand()}`,
    `jalankan di terminal: cloudflared tunnel login, lalu ${ctx.resumeCommand()}`,
  );

function plan(ctx: InitContext, s: TunnelStepState): PlanLine[] {
  // M2: no cloudflared and step 2 does not run now (repair without terminal) → `cloudflared …` would not exist
  if (!s.service.installed && !stepRuns(ctx, "packages"))
    return [
      {
        kind: "warning",
        text: tr(
          "cloudflared is not installed; the tunnel is not set up yet",
          "cloudflared belum terpasang; tunnel belum disiapkan",
        ),
        hint: needsTerminal(ctx),
      },
    ];
  const where = s.host ?? tr("the panel address", "alamat panel");
  const lines: PlanLine[] = [];
  if (s.config === null) {
    lines.push({
      kind: "action",
      text: s.cert
        ? tr(`Creating a tunnel, connecting ${where}`, `Membuat tunnel, menghubungkan ${where}`)
        : tr(
            `Cloudflare login in the browser, creating a tunnel, connecting ${where}`,
            `Login Cloudflare di browser, membuat tunnel, menghubungkan ${where}`,
          ),
    });
    if (!s.cert && !ctx.tty)
      lines.push({
        kind: "warning",
        text: tr(
          "Cloudflare login needs a browser and a terminal; the tunnel is skipped, the other steps still run",
          "Login Cloudflare butuh browser dan terminal; tunnel dilewati, langkah lain tetap jalan",
        ),
        hint: loginHint(ctx),
      });
  } else if (s.configProblem !== null)
    return [
      {
        kind: "error",
        text: s.configProblem,
        hint: tr(
          "fix that file (panel docs cloudflare), then try again",
          "perbaiki file itu (panel docs cloudflare), lalu ulangi",
        ),
      },
    ];
  else if (s.host !== null && !s.ingress) {
    if (s.panelRunning)
      lines.push({
        kind: "warning",
        text: tr(
          `${s.host} is not in ~/.cloudflared/config.yml yet; the panel is running, so that file is not changed`,
          `${s.host} belum ada di ~/.cloudflared/config.yml; panel sedang berjalan, jadi file itu tidak diubah`,
        ),
        hint: tr(`sv down panel, then ${ctx.resumeCommand()}`, `sv down panel, lalu ${ctx.resumeCommand()}`),
      });
    else
      lines.push({
        kind: "action",
        text: tr(
          `Connecting ${s.host} to tunnel ${s.ref} (DNS + config.yml)`,
          `Menghubungkan ${s.host} ke tunnel ${s.ref} (DNS + config.yml)`,
        ),
      });
  }
  if (restartNeedsTerminal(ctx, s.service, ingressWillChange(s)))
    lines.push({
      kind: "warning",
      text: tr(
        "The running cloudflared needs a restart (every site drops briefly); without a terminal the tunnel is not changed",
        "cloudflared yang berjalan perlu dimulai ulang (semua situs putus sebentar); tanpa terminal tunnel tidak diubah",
      ),
      hint: needsTerminal(ctx),
    });
  return [...lines, ...planService(ctx, s.service)];
}

async function apply(ctx: InitContext, s: TunnelStepState): Promise<void> {
  if (s.configProblem !== null) throw new CliExit(INIT_EXIT.failed, s.configProblem, "panel docs cloudflare");
  const noHost = tr(
    "The panel address is not in ~/panel/.env yet (APP_BASE_URL).",
    "Alamat panel belum ada di ~/panel/.env (APP_BASE_URL).",
  );
  if (s.host === null) throw new CliExit(INIT_EXIT.needsUser, noHost, ctx.resumeCommand());
  const ingressChanged = ingressWillChange(s);
  // MINOR 6: the restart question would come after DNS + config.yml; without a terminal stop before both
  if (restartNeedsTerminal(ctx, s.service, ingressChanged))
    throw new CliExit(
      INIT_EXIT.needsUser,
      tr(
        "The running cloudflared needs a restart; the tunnel is not changed without a terminal.",
        "cloudflared yang berjalan perlu dimulai ulang; tunnel tidak diubah tanpa terminal.",
      ),
      needsTerminal(ctx),
    );
  let { ref, id } = s;
  const created = s.config === null;
  if (created) {
    if (!s.cert) await login(ctx, s.cfDir); // exit 3 without a terminal, before any write
    const t = await ensureTunnel(ctx, s.cfDir, s.host);
    [ref, id] = [t.name, t.id];
  }
  if (ref === null || id === null) throw new Error("tunnel: config.yml without tunnel after detect");
  if (ingressChanged) {
    // DNS first: a refused or unanswerable move (exit 3/4) leaves config.yml as it was, so a rerun retries
    await routeDns(ctx, ref, id, s.host);
    if (created) writeConfig(ctx, s, id);
    await addIngress(ctx, s, s.host);
  }
  await applyService(ctx, await detectService(ctx), id, ingressChanged); // run by UUID: no API name lookup
}

/** Step 8 of `panel init`. */
export const tunnelStep = defineStep<TunnelStepState>({
  id: "tunnel",
  detect,
  plan,
  apply,
});
