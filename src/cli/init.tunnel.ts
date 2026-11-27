// `panel init` step 8, tunnel (PLAN/07 §4.4, C19, D4, D10, K9, K10): Cloudflare login → tunnel (reused when its
// credentials are here; init.tunnel.login.ts) → DNS (a record of another tunnel moves only after a TTY yes) →
// config.yml → ingress for the panel hostname → cloudflared service (init.tunnel.service.ts). Every question that
// needs a terminal comes before the first write, so a run without one stops (exit 3) with the phone unchanged.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { insertIngressRule, readTunnelId } from "../server/sites/ingress.editor";
import { type StepContext, StepError } from "../server/sites/job.step";
import type { SiteCtx } from "../server/sites/site.checks";
import { writeAtomic } from "../server/sites/site.files";
import { ingressStep, tunnelState } from "../server/sites/site.steps";
import { DnsRecordExistsError, DnsWrongZoneError } from "../server/system/system.types";
import { HOSTNAME_RE } from "../shared/address.rules";
import { ENV_VARS, type EnvVar } from "../shared/env.schema";
import { probePaths } from "./cli.host";
import { CliExit } from "./cli.output";
import { readEnvFile } from "./env.file";
import { stepRuns } from "./init.plan";
import { ensureTunnel, login } from "./init.tunnel.login";
import {
  applyService,
  detectService,
  planService,
  restartNeedsTerminal,
  type ServiceState,
} from "./init.tunnel.service";
import { defineStep, INIT_EXIT, INIT_STEP_TITLES, type InitContext, type PlanLine } from "./init.types";

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
      if (id === null || !ref) configProblem = "~/.cloudflared/config.yml tidak menyebut tunnel";
    } catch (e) {
      configProblem = `~/.cloudflared/config.yml tidak bisa dibaca (${(e as Error).message})`;
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

const needsTerminal = (ctx: InitContext) => `jalankan ${ctx.resumeCommand()} di terminal`;

function plan(ctx: InitContext, s: TunnelStepState): PlanLine[] {
  // M2: no cloudflared and step 2 does not run now (repair without terminal) → `cloudflared …` would not exist
  if (!s.service.installed && !stepRuns(ctx, "packages"))
    return [{ kind: "warning", text: "cloudflared belum terpasang; tunnel belum disiapkan", hint: needsTerminal(ctx) }];
  const where = s.host ?? "alamat panel";
  const lines: PlanLine[] = [];
  if (s.config === null) {
    const login = s.cert ? "" : "Login Cloudflare di browser, ";
    lines.push({ kind: "action", text: `${login}${login ? "membuat" : "Membuat"} tunnel, menghubungkan ${where}` });
    if (!s.cert && !ctx.tty)
      lines.push({
        kind: "warning",
        text: "Login Cloudflare butuh browser dan terminal; tunnel dilewati, langkah lain tetap jalan",
        hint: `jalankan di terminal: cloudflared tunnel login, lalu ${ctx.resumeCommand()}`,
      });
  } else if (s.configProblem !== null)
    return [{ kind: "error", text: s.configProblem, hint: "perbaiki file itu (panel docs cloudflare), lalu ulangi" }];
  else if (s.host !== null && !s.ingress) {
    if (s.panelRunning)
      lines.push({
        kind: "warning",
        text: `${s.host} belum ada di ~/.cloudflared/config.yml; panel sedang berjalan, jadi file itu tidak diubah`,
        hint: `sv down panel, lalu ${ctx.resumeCommand()}`,
      });
    else lines.push({ kind: "action", text: `Menghubungkan ${s.host} ke tunnel ${s.ref} (DNS + config.yml)` });
  }
  if (restartNeedsTerminal(ctx, s.service, ingressWillChange(s)))
    lines.push({
      kind: "warning",
      text: "cloudflared yang berjalan perlu dimulai ulang (semua situs putus sebentar); tanpa terminal tunnel tidak diubah",
      hint: needsTerminal(ctx),
    });
  return [...lines, ...planService(ctx, s.service)];
}

/** config.yml (600) with only the catch-all; the panel rule is added by `addIngress` right after. */
function writeConfig(ctx: InitContext, s: TunnelStepState, id: string): void {
  const file = join(s.cfDir, "config.yml");
  const text = `tunnel: ${id}\ncredentials-file: ${s.cfDir}/${id}.json\ningress:\n  - service: http_status:404\n`;
  writeAtomic(file, text, { mode: 0o600 });
  ctx.state.changed.push(file);
}

/** DNS for the panel host; a record of another target moves only after confirmRisky('dns-overwrite') (C19). */
async function routeDns(ctx: InitContext, ref: string, id: string, host: string): Promise<void> {
  const cf = ctx.host.system().cloudflared;
  try {
    await cf.routeDns(id, host);
    return;
  } catch (e) {
    if (e instanceof DnsWrongZoneError)
      throw new CliExit(
        INIT_EXIT.failed,
        `cert.pem untuk zona lain: Cloudflare memberi nama ${e.fqdn}, bukan ${host}.`,
        `login ulang dengan domain yang benar: hapus ~/.cloudflared/cert.pem, lalu ${ctx.resumeCommand()}`,
      );
    const msg = `Gagal mengarahkan ${host} ke tunnel ${ref} (periksa internet).`; // cloudflared's text stays out (K10)
    if (!(e instanceof DnsRecordExistsError)) throw new CliExit(INIT_EXIT.failed, msg, ctx.resumeCommand());
  }
  // cloudflared with cert.pem does not tell where the record points, so the old target stays unknown
  ctx.out.line(`${host}: record DNS lain (tujuan tidak terbaca dengan cert.pem) → tunnel ${ref} (${id.slice(0, 8)})`);
  const manual = `cloudflared tunnel route dns --overwrite-dns ${ref} ${host}, lalu ${ctx.resumeCommand()}`;
  const yes = await ctx.confirmRisky(
    "dns-overwrite",
    `Alamat ${host} sudah diarahkan ke tunnel lain. Pindahkan ke tunnel ini? Yang dilayani alamat itu sekarang akan putus.`,
    manual,
  );
  if (!yes) throw new CliExit(INIT_EXIT.cancelled, `Dibatalkan: DNS ${host} tidak diubah.`, `atau jalankan: ${manual}`);
  await cf.routeDns(id, host, { overwrite: true });
}

/** Panel rule above the catch-all through the site jobs' ingressStep (validate, config.yml.bak, atomic rename). */
async function addIngress(ctx: InitContext, s: TunnelStepState, host: string): Promise<void> {
  const file = join(s.cfDir, "config.yml");
  const cf = { ...ctx.host.system().cloudflared, configPath: file };
  const step = ingressStep({ system: { cloudflared: cf } } as unknown as SiteCtx, tunnelState(), [host], false, (t) =>
    insertIngressRule(t, host, `http://localhost:${s.port}`),
  );
  try {
    const quiet: StepContext = { log: () => {} }; // ingressStep never logs
    await step.run(quiet);
  } catch (e) {
    if (!(e instanceof StepError)) throw e;
    throw new CliExit(
      INIT_EXIT.failed,
      `${host} tidak bisa ditambahkan ke ~/.cloudflared/config.yml (${e.code}).`,
      "periksa file itu (panel docs cloudflare); isi lama tidak berubah",
    );
  }
  ctx.state.changed.push(file, `${file}.bak`);
}

async function apply(ctx: InitContext, s: TunnelStepState): Promise<void> {
  if (s.configProblem !== null) throw new CliExit(INIT_EXIT.failed, s.configProblem, "panel docs cloudflare");
  const noHost = "Alamat panel belum ada di ~/panel/.env (APP_BASE_URL).";
  if (s.host === null) throw new CliExit(INIT_EXIT.needsUser, noHost, ctx.resumeCommand());
  const ingressChanged = ingressWillChange(s);
  // MINOR 6: the restart question would come after DNS + config.yml; without a terminal stop before both
  if (restartNeedsTerminal(ctx, s.service, ingressChanged))
    throw new CliExit(
      INIT_EXIT.needsUser,
      "cloudflared yang berjalan perlu dimulai ulang; tunnel tidak diubah tanpa terminal.",
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
  title: INIT_STEP_TITLES.tunnel,
  detect,
  plan,
  apply,
});
