// Coded job steps on shared state: config.yml ingress, cloudflared restart, DNS records, HTTPS probe (PLAN/03 §3.4).

import { copyFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { HealthProbe } from "../../shared/site.types";
import { DnsZoneNotFoundError, type SiteDnsProvider } from "../cloudflare/dns.provider";
import { DnsConflictError, DnsNotConfiguredError } from "../cloudflare/dns.types";
import type { site } from "../db/schema";
import { appRestartStep, healthStep } from "../deploy/deploy.restart";
import { newState } from "../deploy/deploy.steps";
import { passes } from "../deploy/health.check";
import { log } from "../log.service";
import { type CloudflaredAdapter, DnsWrongZoneError, type RunitAdapter } from "../system/system.types";
import { parseApps, removeApp } from "./apps.file";
import { IngressEditError } from "./ingress.editor";
import { type StepDef, StepError, type StepOutcome } from "./job.runner";
import { type SiteCtx, sitePaths } from "./site.checks";
import { fsyncPath, readTextOrNull, restoreText, tempPathFor, writeAtomic, writeFileSynced } from "./site.files";

/** runit service name of the tunnel. */
export const CLOUDFLARED_SERVICE = "cloudflared";
/** How long to wait for cloudflared to be `run` again after a restart. */
const CLOUDFLARED_UP_TIMEOUT_MS = 30_000;
const POLL_MS = 500;
const MS_PER_SEC = 1000;
const HTTP_SERVER_ERROR = 500;

/** Per-job flags shared by ingress/restart steps so rollback can re-apply the restored config. */
export type TunnelState = { ingressChanged: boolean; restarted: boolean };
/** Fresh tunnel flags for one job. */
export const tunnelState = (): TunnelState => ({ ingressChanged: false, restarted: false });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const list = (hosts: string[]) => hosts.join(", ");

/**
 * Edits config.yml via `mutate`: the candidate is written next to it and validated with cloudflared first, then
 * the old file is copied to config.yml.bak and the candidate renamed over it, so the live config is never invalid.
 * Undo writes back the exact previous bytes. `removing` picks the outcome code.
 */
export function ingressStep(
  ctx: SiteCtx,
  st: TunnelState,
  hostnames: string[],
  removing: boolean,
  mutate: (t: string) => string,
): StepDef {
  const path = ctx.system.cloudflared.configPath;
  let prev: string | null = null;
  let mode = 0o644;
  return {
    key: "ingress",
    async run() {
      prev = readTextOrNull(path);
      if (prev === null) throw new StepError("ingress_config_missing", { path });
      mode = statSync(path).mode & 0o777;
      let next: string;
      try {
        next = mutate(prev);
      } catch (e) {
        if (e instanceof IngressEditError) throw new StepError("ingress_unsupported", {}, e.message);
        throw e;
      }
      if (next === prev) return { code: "ingress_unchanged", skipped: true };
      const tmp = tempPathFor(path);
      writeFileSynced(tmp, next, mode);
      try {
        const v = await ctx.system.cloudflared.validate(tmp);
        if (!v.ok) throw new StepError("ingress_rejected", {}, `cloudflared rejected the new ingress: ${v.message}`);
        copyFileSync(path, `${path}.bak`);
        fsyncPath(`${path}.bak`);
        renameSync(tmp, path); // atomic: same directory
        fsyncPath(dirname(path)); // the rename survives a power cut (A9)
      } finally {
        rmSync(tmp, { force: true });
      }
      st.ingressChanged = true;
      return { code: removing ? "ingress_removed" : "ingress_added", params: { hostnames: list(hostnames) } };
    },
    async undo() {
      restoreText(path, prev, mode);
    },
  };
}

async function restartAndWait(runit: RunitAdapter): Promise<number> {
  const t0 = Date.now();
  const s = await runit.control(CLOUDFLARED_SERVICE, "restart");
  if (!s) throw new StepError("tunnel_service_missing");
  const deadline = t0 + CLOUDFLARED_UP_TIMEOUT_MS;
  for (;;) {
    const cur = await runit.supervise(CLOUDFLARED_SERVICE);
    if (cur?.state === "run") return Math.round((Date.now() - t0) / MS_PER_SEC);
    if (Date.now() > deadline)
      throw new StepError("tunnel_not_running", { seconds: CLOUDFLARED_UP_TIMEOUT_MS / MS_PER_SEC });
    await sleep(POLL_MS);
  }
}

/** Restarts cloudflared (drops every domain for a few seconds) only when the ingress text changed (D29). */
export const tunnelRestartStep = (ctx: SiteCtx, st: TunnelState): StepDef => ({
  key: "tunnel_restart",
  async run() {
    if (!st.ingressChanged) return { code: "tunnel_unchanged", skipped: true };
    st.restarted = true;
    return { code: "tunnel_restarted", params: { seconds: await restartAndWait(ctx.system.runit) } };
  },
});

/** Rollback hook: after config.yml was restored, restart again so cloudflared serves the old config. */
export async function reapplyTunnel(ctx: SiteCtx, st: TunnelState): Promise<void> {
  if (!st.restarted) return;
  log.warn("[sites] restarting cloudflared again after rollback");
  await restartAndWait(ctx.system.runit);
}

/** Maps DNS provider errors of `hostname` to step codes. */
function dnsError(e: unknown, hostname: string): never {
  if (e instanceof DnsConflictError) throw new StepError("dns_conflict", { hostname }, e.message);
  if (e instanceof DnsZoneNotFoundError) throw new StepError("dns_zone_missing", { hostname }, e.message);
  if (e instanceof StepError) throw e;
  throw new StepError("dns_api_failed", { hostname }, (e as Error).message);
}

/**
 * No API token: `cloudflared tunnel route dns` with the login cert (`cert.pem` next to config.yml; only its existence
 * is checked) creates the CNAMEs (PLAN/06 §6.4 B). The panel cannot delete those records later (`dnsManaged` stays
 * false). No cert → `dns_no_token`; cloudflared refuses (e.g. a record exists) → `dns_route_failed`; the name
 * landed under the cert's other zone → `dns_wrong_zone` (stops routing). All three skip, so the site is still
 * created and the web shows the copy-ready record: failing would roll back and fail the same way on every retry.
 */
async function routeWithCert(cf: CloudflaredAdapter | undefined, hostnames: string[], tunnel: string) {
  const hosts = list(hostnames);
  if (!cf || !existsSync(join(dirname(cf.configPath), "cert.pem")))
    return { code: "dns_no_token", params: { hostnames: hosts }, skipped: true } satisfies StepOutcome;
  for (const h of hostnames) {
    try {
      await cf.routeDns(tunnel, h);
    } catch (e) {
      const wrong = e instanceof DnsWrongZoneError;
      log.warn(`[sites] cloudflared route dns ${h} failed: ${(e as Error).message}`);
      return {
        code: wrong ? "dns_wrong_zone" : "dns_route_failed",
        params: { hostname: h, hostnames: hosts, ...(wrong ? { fqdn: e.fqdn } : {}) },
        detail: (e as Error).message,
        skipped: true,
      } satisfies StepOutcome;
    }
  }
  return { code: "dns_routed", params: { hostnames: hosts } };
}

/**
 * Points every hostname at the tunnel. Token not set → `routeWithCert` when `cloudflared` is given, else skipped.
 * `owned` gets the hostnames whose record the panel owns (a hand-made CNAME to the same tunnel is used but not
 * owned). Undo deletes the records this step created through the API (cert-routed ones cannot be deleted).
 */
export function dnsEnsureStep(
  dns: SiteDnsProvider,
  hostnames: string[],
  tunnelId: () => string | null,
  owned: Set<string>,
  actorId: string | null,
  cloudflared?: CloudflaredAdapter,
): StepDef {
  const created: string[] = [];
  return {
    key: "dns",
    async run() {
      const id = tunnelId();
      if (!id) throw new StepError("dns_no_tunnel_id");
      const same: string[] = [];
      for (const h of hostnames) {
        try {
          const r = await dns.ensureTunnelCname(h, id, actorId);
          if (r.created) created.push(h);
          if (r.owned === false) same.push(h);
          else owned.add(h);
        } catch (e) {
          if (e instanceof DnsNotConfiguredError) return routeWithCert(cloudflared, hostnames, id);
          dnsError(e, h);
        }
      }
      if (created.length) return { code: "dns_created", params: { hostnames: list(created) } };
      if (same.length) return { code: "dns_same_tunnel", params: { hostnames: list(same) } };
      return { code: "dns_owned_present" };
    },
    async undo() {
      for (const h of created) await dns.deleteManaged(h, actorId);
    },
  };
}

/**
 * Deletes the panel-owned records of `hostnames`. Runs after the tunnel restart and never fails the job (D29):
 * an API error leaves `dns_left` with the hostnames still to clean up in the dashboard.
 */
export function dnsDeleteStep(dns: SiteDnsProvider, hostnames: string[], actorId: string | null): StepDef {
  return {
    key: "dns",
    async run() {
      if (hostnames.length === 0) return { code: "dns_none_owned", skipped: true };
      const left: string[] = [];
      let detail: string | null = null;
      for (const h of hostnames) {
        try {
          await dns.deleteManaged(h, actorId);
        } catch (e) {
          if (e instanceof DnsNotConfiguredError) return { code: "dns_no_token", skipped: true };
          left.push(h);
          detail = `${h}: ${(e as Error).message}`;
          log.warn(`[sites] DNS delete of ${h} failed (left in Cloudflare): ${(e as Error).message}`);
        }
      }
      if (left.length) return { code: "dns_left", params: { hostnames: list(left) }, detail };
      return { code: "dns_deleted", params: { hostnames: list(hostnames) } };
    },
  };
}

/** One HTTPS probe of the first new hostname after the restart; never fails (a fresh site has no app yet). */
export const domainProbeStep = (ctx: SiteCtx, hostnames: string[]): StepDef => ({
  key: "domain_probe",
  async run() {
    const hostname = hostnames[0] as string;
    const r = await ctx.system.cloudflared.probe(hostname);
    const ok = r.status !== null && r.status < HTTP_SERVER_ERROR;
    return { code: ok ? "domain_reachable" : "domain_not_yet", params: { hostname, status: r.status } };
  },
});

/** apps.json without the panel entry of `name`; undo writes back the exact previous bytes. */
export function appsRemoveStep(ctx: SiteCtx, name: string, managed: boolean): StepDef {
  const { appsJson } = sitePaths(ctx);
  let prev: string | null = null;
  return {
    key: "apps_remove",
    async run() {
      if (!managed) return { code: "apps_adopted_skip", skipped: true };
      prev = readTextOrNull(appsJson);
      let apps: Record<string, unknown>[];
      try {
        apps = parseApps(prev);
      } catch (e) {
        throw new StepError("apps_json_invalid", {}, (e as Error).message);
      }
      if (!apps.some((a) => a.name === name)) return { code: "apps_absent", skipped: true };
      writeAtomic(appsJson, removeApp(prev, name), { backup: true });
      return { code: "apps_removed", params: { name } };
    },
    async undo() {
      if (prev !== null) restoreText(appsJson, prev);
    },
  };
}

type SiteRow = typeof site.$inferSelect;

/** app_restart → health (deploy's D16 check), shared by site.restart, site.env and their cleanups. */
export function restartSteps(ctx: SiteCtx, s: SiteRow): StepDef[] {
  const st = newState(s.runtime);
  return [appRestartStep(ctx, s, st), healthStep(ctx, s, st)];
}

const HEALTH_PROBE_TIMEOUT_MS = 5000;

/** GET /sites/:name/health: one probe with the site's path/expect and Host = its first domain. */
export async function probeHealth(ctx: SiteCtx, s: SiteRow, host: string | undefined): Promise<HealthProbe> {
  const t0 = Date.now();
  const { net } = ctx.system;
  const status = (await net.isListening(s.port))
    ? await net.httpStatus(s.port, s.healthPath, HEALTH_PROBE_TIMEOUT_MS, host)
    : null;
  const ms = status === null ? null : Date.now() - t0;
  return { ok: passes(status, s.healthExpect), status, ms, path: s.healthPath, checkedAt: new Date().toISOString() };
}
