/** Contract for the DNS backend that points site hostnames at the phone's Cloudflare Tunnel. */
export interface DnsProvider {
  verify(): Promise<{ ok: boolean; message: string }>;
  ensureTunnelCname(hostname: string, tunnelId: string): Promise<{ recordId: string; created: boolean }>;
  deleteManaged(hostname: string): Promise<void>;
}

/** What a hostname's DNS looks like to the panel (POST /sites/check notes and issues). */
export type DnsInspect = "absent" | "owned" | "same_tunnel" | "conflict";

/**
 * DnsProvider as the site jobs use it: `actorId` is recorded in the dns.* audit rows; a CNAME the panel does not own
 * but that already points at this tunnel is accepted (`owned: false`, PLAN/03 §4.13). Any plain DnsProvider fits.
 */
export type SiteDnsProvider = {
  verify(): Promise<{ ok: boolean; message: string }>;
  ensureTunnelCname(
    hostname: string,
    tunnelId: string,
    actorId?: string | null,
  ): Promise<{ recordId: string; created: boolean; owned?: boolean }>;
  deleteManaged(hostname: string, actorId?: string | null): Promise<void>;
  inspect?(hostname: string, tunnelId: string): Promise<DnsInspect>;
};

export class DnsConflictError extends Error {} // record exists that the panel did not create
export class DnsNotConfiguredError extends Error {} // no token set
