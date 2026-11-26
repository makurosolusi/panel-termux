// Reusable job steps that touch shared state: config.yml ingress, cloudflared restart, DNS records.
import { chmodSync, copyFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { DnsNotConfiguredError, type DnsProvider } from "../cloudflare/dns.types";
import { log } from "../log.service";
import type { RunitAdapter } from "../system/system.types";
import type { StepDef } from "./job.runner";
import type { SiteCtx } from "./site.checks";
import { readTextOrNull, restoreText, tempPathFor } from "./site.files";

/** runit service name of the tunnel. */
export const CLOUDFLARED_SERVICE = "cloudflared";
/** How long to wait for cloudflared to be `run` again after a restart. */
const CLOUDFLARED_UP_TIMEOUT_MS = 30_000;
const POLL_MS = 500;

/** Per-job flags shared by ingress/restart steps so rollback can re-apply the restored config. */
export type TunnelState = { ingressChanged: boolean; restarted: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Edits config.yml via `mutate`: the candidate is written to a temp file next to it and validated with
 * cloudflared first, then the old file is copied to config.yml.bak and the candidate renamed over it,
 * so the live config is never invalid. Undo writes back the exact previous bytes.
 */
export function ingressStep(ctx: SiteCtx, st: TunnelState, label: string, mutate: (t: string) => string): StepDef {
  const path = ctx.system.cloudflared.configPath;
  let prev: string | null = null;
  let mode = 0o644;
  return {
    key: "ingress",
    label,
    async run() {
      prev = readTextOrNull(path);
      if (prev === null) throw new Error(`${path} not found`);
      mode = statSync(path).mode & 0o777;
      const next = mutate(prev);
      if (next === prev) return { skipped: "ingress already up to date" };
      const tmp = tempPathFor(path);
      writeFileSync(tmp, next, { mode });
      chmodSync(tmp, mode);
      try {
        const v = await ctx.system.cloudflared.validate(tmp);
        if (!v.ok) throw new Error(`cloudflared rejected the new ingress: ${v.message}`);
        copyFileSync(path, `${path}.bak`);
        renameSync(tmp, path); // atomic: same directory
      } finally {
        rmSync(tmp, { force: true });
      }
      st.ingressChanged = true;
      return "config.yml updated (backup: config.yml.bak)";
    },
    async undo() {
      restoreText(path, prev, mode);
    },
  };
}

async function restartAndWait(runit: RunitAdapter): Promise<string> {
  const s = await runit.control(CLOUDFLARED_SERVICE, "restart");
  if (!s) throw new Error(`runit service ${CLOUDFLARED_SERVICE} not found`);
  const deadline = Date.now() + CLOUDFLARED_UP_TIMEOUT_MS;
  for (;;) {
    const cur = (await runit.list()).find((x) => x.name === CLOUDFLARED_SERVICE);
    if (cur?.state === "run") return `cloudflared running (pid ${cur.pid ?? "?"})`;
    if (Date.now() > deadline)
      throw new Error(`cloudflared not running ${CLOUDFLARED_UP_TIMEOUT_MS / 1000}s after restart`);
    await sleep(POLL_MS);
  }
}

/** Restarts cloudflared (drops every domain for a few seconds) when the ingress changed. */
export const restartStep = (ctx: SiteCtx, st: TunnelState): StepDef => ({
  key: "restart",
  label: "Restart cloudflared",
  async run() {
    if (!st.ingressChanged) return { skipped: "ingress unchanged, no restart needed" };
    st.restarted = true;
    return restartAndWait(ctx.system.runit);
  },
});

/** Rollback hook: after config.yml was restored, restart again so cloudflared serves the old config. */
export async function reapplyTunnel(ctx: SiteCtx, st: TunnelState): Promise<void> {
  if (!st.restarted) return;
  log.warn("[sites] restarting cloudflared again after rollback");
  await restartAndWait(ctx.system.runit);
}

/** Points `hostname` at the tunnel. Not configured → skipped. `out.managed` tells if the panel owns the record. */
export function dnsEnsureStep(
  dns: DnsProvider,
  hostname: string,
  tunnelId: () => string | null,
  out: { managed: boolean },
): StepDef {
  let created = false;
  return {
    key: "dns",
    label: `DNS record for ${hostname}`,
    async run() {
      const id = tunnelId();
      if (!id) throw new Error("config.yml: no tunnel UUID in tunnel: or the credentials-file name");
      try {
        const r = await dns.ensureTunnelCname(hostname, id);
        created = r.created;
        out.managed = true;
        return r.created ? "CNAME created" : "panel-managed CNAME already present";
      } catch (e) {
        if (e instanceof DnsNotConfiguredError) {
          return { skipped: "Cloudflare token not set: set it in /dev settings, then create the DNS record" };
        }
        throw e;
      }
    },
    async undo() {
      if (created) await dns.deleteManaged(hostname);
    },
  };
}

/** Deletes the panel-managed records of `hostnames` (others skipped); undo re-creates them. */
export function dnsDeleteStep(dns: DnsProvider, hostnames: string[], tunnelId: () => string | null): StepDef {
  const deleted: string[] = [];
  return {
    key: "dns",
    label: "Delete DNS records",
    async run() {
      if (hostnames.length === 0) return { skipped: "no panel-managed DNS records" };
      for (const h of hostnames) {
        try {
          await dns.deleteManaged(h);
          deleted.push(h);
        } catch (e) {
          if (e instanceof DnsNotConfiguredError)
            return { skipped: "Cloudflare token not set; DNS records left as is" };
          throw e;
        }
      }
      return `deleted ${deleted.join(", ")}`;
    },
    async undo() {
      const id = tunnelId();
      if (!id) throw new Error("config.yml: no tunnel UUID in tunnel: or the credentials-file name");
      for (const h of deleted) await dns.ensureTunnelCname(h, id);
    },
  };
}
