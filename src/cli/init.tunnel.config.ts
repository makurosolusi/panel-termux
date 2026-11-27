// Writes of step 8 tunnel (split from init.tunnel.ts): config.yml, the panel host's DNS route (moving another
// tunnel's record only after a TTY yes, C19) and the panel ingress rule.
import { join } from "node:path";
import { insertIngressRule } from "../server/sites/ingress.editor";
import { type StepContext, StepError } from "../server/sites/job.step";
import type { SiteCtx } from "../server/sites/site.checks";
import { writeAtomic } from "../server/sites/site.files";
import { ingressStep, tunnelState } from "../server/sites/site.steps";
import { DnsRecordExistsError, DnsWrongZoneError } from "../server/system/system.types";
import { tr } from "./cli.locale";
import { CliExit } from "./cli.output";
import type { TunnelStepState } from "./init.tunnel";
import { INIT_EXIT, type InitContext } from "./init.types";

/** config.yml (600) with only the catch-all; the panel rule is added by `addIngress` right after. */
export function writeConfig(ctx: InitContext, s: TunnelStepState, id: string): void {
  const file = join(s.cfDir, "config.yml");
  const text = `tunnel: ${id}\ncredentials-file: ${s.cfDir}/${id}.json\ningress:\n  - service: http_status:404\n`;
  writeAtomic(file, text, { mode: 0o600 });
  ctx.state.changed.push(file);
}

/** DNS for the panel host; a record of another target moves only after confirmRisky('dns-overwrite') (C19). */
export async function routeDns(ctx: InitContext, ref: string, id: string, host: string): Promise<void> {
  const cf = ctx.host.system().cloudflared;
  try {
    await cf.routeDns(id, host);
    return;
  } catch (e) {
    if (e instanceof DnsWrongZoneError)
      throw new CliExit(
        INIT_EXIT.failed,
        tr(
          `cert.pem is for another zone: Cloudflare gave the name ${e.fqdn}, not ${host}.`,
          `cert.pem untuk zona lain: Cloudflare memberi nama ${e.fqdn}, bukan ${host}.`,
        ),
        tr(
          `log in again with the right domain: delete ~/.cloudflared/cert.pem, then ${ctx.resumeCommand()}`,
          `login ulang dengan domain yang benar: hapus ~/.cloudflared/cert.pem, lalu ${ctx.resumeCommand()}`,
        ),
      );
    // cloudflared's text stays out (K10)
    const msg = tr(
      `Could not point ${host} to tunnel ${ref} (check the internet).`,
      `Gagal mengarahkan ${host} ke tunnel ${ref} (periksa internet).`,
    );
    if (!(e instanceof DnsRecordExistsError)) throw new CliExit(INIT_EXIT.failed, msg, ctx.resumeCommand());
  }
  // cloudflared with cert.pem does not tell where the record points, so the old target stays unknown
  const short = id.slice(0, 8);
  ctx.out.line(
    tr(
      `${host}: another DNS record (its target cannot be read with cert.pem) → tunnel ${ref} (${short})`,
      `${host}: record DNS lain (tujuan tidak terbaca dengan cert.pem) → tunnel ${ref} (${short})`,
    ),
  );
  const route = `cloudflared tunnel route dns --overwrite-dns ${ref} ${host}`;
  const manual = tr(`${route}, then ${ctx.resumeCommand()}`, `${route}, lalu ${ctx.resumeCommand()}`);
  const yes = await ctx.confirmRisky(
    "dns-overwrite",
    tr(
      `${host} already points to another tunnel. Move it to this tunnel? Whatever that address serves now will go down.`,
      `Alamat ${host} sudah diarahkan ke tunnel lain. Pindahkan ke tunnel ini? Yang dilayani alamat itu sekarang akan putus.`,
    ),
    manual,
  );
  if (!yes)
    throw new CliExit(
      INIT_EXIT.cancelled,
      tr(`Cancelled: DNS of ${host} not changed.`, `Dibatalkan: DNS ${host} tidak diubah.`),
      tr(`or run: ${manual}`, `atau jalankan: ${manual}`),
    );
  await cf.routeDns(id, host, { overwrite: true });
}

/** Panel rule above the catch-all through the site jobs' ingressStep (validate, config.yml.bak, atomic rename). */
export async function addIngress(ctx: InitContext, s: TunnelStepState, host: string): Promise<void> {
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
      tr(
        `${host} cannot be added to ~/.cloudflared/config.yml (${e.code}).`,
        `${host} tidak bisa ditambahkan ke ~/.cloudflared/config.yml (${e.code}).`,
      ),
      tr(
        "check that file (panel docs cloudflare); its old content is unchanged",
        "periksa file itu (panel docs cloudflare); isi lama tidak berubah",
      ),
    );
  }
  ctx.state.changed.push(file, `${file}.bak`);
}
