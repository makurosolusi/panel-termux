/** Contract for the DNS backend that points site hostnames at the phone's Cloudflare Tunnel. */
export interface DnsProvider {
  verify(): Promise<{ ok: boolean; message: string }>;
  ensureTunnelCname(hostname: string, tunnelId: string): Promise<{ recordId: string; created: boolean }>;
  deleteManaged(hostname: string): Promise<void>;
}
export class DnsConflictError extends Error {} // record exists that the panel did not create
export class DnsNotConfiguredError extends Error {} // no token set
