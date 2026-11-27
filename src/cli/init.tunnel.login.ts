// `panel init` step 8, the account side of the tunnel (PLAN/07 §4.4, C19, D4, K10): Cloudflare login and finding or
// creating the tunnel. cloudflared output is never printed: `tunnel create` runs without `-o` (D4: `-o json` prints
// the tunnel token) and errors carry the exit code only.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CliExit } from "./cli.output";
import { INIT_EXIT, type InitContext } from "./init.types";

/** cloudflared calls that reach the Cloudflare API from the phone (slow mobile networks). */
const API_TIMEOUT_MS = 30_000;
/** Tunnel names we create/accept (cloudflared allows more; we keep them safe for argv and the run script). */
const TUNNEL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Q7: `panel.contoh.com` → `panel-contoh-com` (prefix `panel-` + the domain without its first label). */
export function defaultTunnelName(host: string): string {
  const domain = host.split(".").slice(1).join("-");
  return `panel-${domain || host.replaceAll(".", "-")}`.slice(0, 63);
}

/** One line of cloudflared's exit for an error message: the code only (K10: its output may hold secrets). */
const cfFail = (what: string, code: number, ctx: InitContext) =>
  new CliExit(
    INIT_EXIT.failed,
    `cloudflared ${what} gagal (kode ${code}).`,
    `periksa internet, lalu ${ctx.resumeCommand()}`,
  );

export async function login(ctx: InitContext, cfDir: string): Promise<void> {
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
  const cert = join(cfDir, "cert.pem");
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
export async function ensureTunnel(
  ctx: InitContext,
  cfDir: string,
  host: string,
): Promise<{ name: string; id: string }> {
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
      const cred = join(cfDir, `${id}.json`);
      if (!existsSync(cred)) throw new CliExit(INIT_EXIT.failed, `Kredensial tunnel ${name} tidak ada di ${cred}.`);
      ctx.state.changed.push(cred);
      return { name, id };
    }
    if (existsSync(join(cfDir, `${id}.json`))) {
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
