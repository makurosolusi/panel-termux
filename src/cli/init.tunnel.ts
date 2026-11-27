// `panel init` step 8, tunnel (PLAN/07 §4.4, C19, D4, D10, K9, K10): Cloudflare login → tunnel (reused when its
// credentials are here) → config.yml → DNS (a record of another tunnel moves only after a TTY yes) → ingress for
// the panel hostname → cloudflared service (init.tunnel.service.ts). cloudflared output is never printed (K10):
// `tunnel create` runs without `-o` (D4: `-o json` prints the tunnel token) and errors carry the exit code only.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { insertIngressRule, readTunnelId } from "../server/sites/ingress.editor";
import { type StepContext, StepError } from "../server/sites/job.step";
import { HOSTNAME_RE, type SiteCtx } from "../server/sites/site.checks";
import { writeAtomic } from "../server/sites/site.files";
import { ingressStep, tunnelState } from "../server/sites/site.steps";
import { DnsRecordExistsError, DnsWrongZoneError } from "../server/system/system.types";
import { ENV_VARS, type EnvVar } from "../shared/env.schema";
import { probePaths } from "./cli.host";
import { CliExit } from "./cli.output";
import { readEnvFile } from "./env.file";
import { applyService, detectService, planService, type ServiceState } from "./init.tunnel.service";
import { defineStep, INIT_EXIT, INIT_STEP_TITLES, type InitContext, type PlanLine } from "./init.types";

/** cloudflared calls that reach the Cloudflare API from the phone (slow mobile networks). */
const API_TIMEOUT_MS = 30_000;
/** Tunnel names we create/accept (cloudflared allows more; we keep them safe for argv and the run script). */
const TUNNEL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

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

/** Q7: `panel.contoh.com` → `panel-contoh-com` (prefix `panel-` + the domain without its first label). */
export function defaultTunnelName(host: string): string {
  const domain = host.split(".").slice(1).join("-");
  return `panel-${domain || host.replaceAll(".", "-")}`.slice(0, 63);
}

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

function plan(ctx: InitContext, s: TunnelStepState): PlanLine[] {
  const where = s.host ?? "alamat panel";
  if (s.config === null) {
    const login = s.cert ? "" : "Login Cloudflare di browser, ";
    const text = `${login}${login ? "membuat" : "Membuat"} tunnel, menghubungkan ${where}`;
    return [{ kind: "action", text }];
  }
  if (s.configProblem !== null)
    return [{ kind: "error", text: s.configProblem, hint: "perbaiki file itu (panel docs cloudflare), lalu ulangi" }];
  const lines: PlanLine[] = [];
  if (s.host !== null && !s.ingress) {
    if (s.panelRunning)
      lines.push({
        kind: "warning",
        text: `${s.host} belum ada di ~/.cloudflared/config.yml; panel sedang berjalan, jadi file itu tidak diubah`,
        hint: `sv down panel, lalu ${ctx.resumeCommand()}`,
      });
    else lines.push({ kind: "action", text: `Menghubungkan ${s.host} ke tunnel ${s.ref} (DNS + config.yml)` });
  }
  return [...lines, ...planService(ctx, s.service)];
}

/** One line of cloudflared's exit for an error message: the code only (K10: its output may hold secrets). */
const cfFail = (what: string, code: number, ctx: InitContext) =>
  new CliExit(
    INIT_EXIT.failed,
    `cloudflared ${what} gagal (kode ${code}).`,
    `periksa internet, lalu ${ctx.resumeCommand()}`,
  );

async function login(ctx: InitContext, s: TunnelStepState): Promise<void> {
  if (!ctx.tty)
    throw new CliExit(
      INIT_EXIT.needsUser,
      "Login Cloudflare butuh browser dan terminal.",
      `jalankan di terminal: cloudflared tunnel login, lalu ${ctx.resumeCommand()}`,
    );
  ctx.out.line("Login Cloudflare di browser: buka alamat yang muncul di bawah, lalu pilih domain panel.");
  let opened = false;
  const code = await ctx.host.run("cloudflared", ["tunnel", "login"], {
    onLine: (line) => {
      const url = /https:\/\/\S+/.exec(line)?.[0];
      if (!url || opened) return;
      opened = true;
      ctx.out.line(`Bila browser tidak terbuka sendiri, buka: ${url}`); // one-time login URL, not a secret (D14)
      ctx.host.exec("termux-open-url", [url]).catch(() => {
        ctx.out.note("ℹ️ termux-open-url tidak tersedia; buka alamat di atas secara manual.");
      });
    },
  });
  const cert = join(s.cfDir, "cert.pem");
  if (code !== 0 || !existsSync(cert)) throw cfFail("tunnel login", code, ctx);
  ctx.state.changed.push(cert);
}

type TunnelRow = { id?: unknown; name?: unknown };

/** UUID of tunnel `name` from `tunnel list -n <name> -o json` (no secrets in that JSON); null = no such tunnel. */
async function tunnelIdOf(ctx: InitContext, name: string): Promise<string | null> {
  const r = await ctx.host.exec("cloudflared", ["tunnel", "list", "-n", name, "-o", "json"], {
    timeoutMs: API_TIMEOUT_MS,
  });
  if (r.code !== 0) throw cfFail("tunnel list", r.code, ctx);
  let rows: TunnelRow[];
  try {
    rows = JSON.parse(r.stdout || "[]") as TunnelRow[];
  } catch (e) {
    throw new CliExit(INIT_EXIT.failed, `cloudflared tunnel list: output bukan JSON (${(e as Error).message}).`);
  }
  const row = (Array.isArray(rows) ? rows : []).find((t) => t?.name === name && typeof t.id === "string");
  return row ? (row.id as string).toLowerCase() : null;
}

async function askName(ctx: InitContext, suggested: string): Promise<string> {
  for (;;) {
    const a = (await ctx.prompt.ask(`Nama tunnel [${suggested}]:`))?.trim().toLowerCase();
    if (!a) return suggested; // Enter or EOF = the default
    if (TUNNEL_NAME_RE.test(a)) return a;
    ctx.out.line("Nama tunnel: huruf kecil, angka, dan tanda minus (mis. panel-contoh-com).");
  }
}

/** C19: reuse a tunnel whose credentials are here, create it when missing, other name when it is not ours. */
async function ensureTunnel(ctx: InitContext, s: TunnelStepState, host: string): Promise<{ name: string; id: string }> {
  let name = defaultTunnelName(host);
  if (ctx.tty) name = await askName(ctx, name);
  for (;;) {
    let id = await tunnelIdOf(ctx, name);
    if (id === null) {
      const r = await ctx.host.exec("cloudflared", ["tunnel", "create", name], { timeoutMs: API_TIMEOUT_MS }); // no -o (D4)
      if (r.code !== 0) throw cfFail(`tunnel create ${name}`, r.code, ctx);
      id = await tunnelIdOf(ctx, name);
      if (id === null)
        throw new CliExit(INIT_EXIT.failed, `Tunnel ${name} sudah dibuat tetapi tidak muncul di daftar.`);
      const cred = join(s.cfDir, `${id}.json`);
      if (!existsSync(cred)) throw new CliExit(INIT_EXIT.failed, `Kredensial tunnel ${name} tidak ada di ${cred}.`);
      ctx.state.changed.push(cred);
      return { name, id };
    }
    if (existsSync(join(s.cfDir, `${id}.json`))) {
      ctx.out.line(`Tunnel ${name} sudah ada dan kredensialnya ada di HP ini: dipakai ulang.`);
      return { name, id };
    }
    if (!ctx.tty)
      throw new CliExit(
        INIT_EXIT.needsUser,
        `Tunnel ${name} sudah ada di akun Cloudflare, tetapi kredensialnya tidak ada di HP ini.`,
        `pilih nama lain: jalankan ${ctx.resumeCommand()} di terminal; atau bila tunnel itu tidak dipakai lagi: cloudflared tunnel delete ${name}`,
      );
    ctx.out.line(
      `Tunnel ${name} sudah ada di akun Cloudflare, tetapi kredensialnya tidak ada di HP ini. Pilih nama lain.`,
    );
    name = await askName(ctx, `${name}-2`);
  }
}

/** config.yml (600) with only the catch-all; the panel rule is added by `addIngress` after DNS. */
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
  let { ref, id } = s;
  let ingressChanged = false;
  const created = s.config === null;
  if (created) {
    if (!s.cert) await login(ctx, s);
    const t = await ensureTunnel(ctx, s, s.host);
    writeConfig(ctx, s, t.id);
    [ref, id] = [t.name, t.id];
  }
  if (ref === null || id === null) throw new Error("tunnel: config.yml without tunnel after detect");
  // An existing config.yml is edited only while the panel is down (D10); a config we just wrote is ours.
  if (!s.ingress && (created || !s.panelRunning)) {
    await routeDns(ctx, ref, id, s.host); // before ingress: a cancelled move leaves the rule out, so a rerun retries
    await addIngress(ctx, s, s.host);
    ingressChanged = true;
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
