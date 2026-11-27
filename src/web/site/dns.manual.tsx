import { ExternalLinkIcon } from "lucide-react";
import { Link } from "react-router";
import type { JobStep } from "@/shared/job.types";
import type { Domain } from "@/shared/panel.types";
import { hasRole } from "@/shared/roles";
import type { Integration } from "@/shared/site.types";
import { CopyButton } from "@/web/components/copy-button";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { DomainCheckButton } from "@/web/panel/domain.check";
import { panelUrl } from "@/web/panel/panel.api";
import { TOUCH_BOX } from "@/web/panel/panel.touch";
import { useMe } from "@/web/session/use-me";
import { useApiQuery } from "@/web/shared/use-api-query";

const t = idSiteDetail.dnsManual;
/** Cloudflare's API token page (generic: the permission-template URL is not verified, PLAN/06 §6.4 A). */
export const CLOUDFLARE_TOKENS_URL = "https://dash.cloudflare.com/profile/api-tokens";
/** Settings card of the Cloudflare token (super_admin page). */
const SETTINGS_TOKEN_PATH = "/dev/settings#cloudflare";
/** dns step codes after which the user still has to create the record by hand. */
const MANUAL_DNS_CODES: ReadonlySet<string> = new Set(["dns_no_token", "dns_route_failed", "dns_wrong_zone"]);

/** One CNAME the user creates in the Cloudflare dashboard. */
export type DnsRecord = { type: "CNAME"; name: string; content: string; proxied: true };

/** Copy-ready CNAME per hostname to the tunnel (`<tunnelId>.cfargotunnel.com`, proxied, as cloudflared creates it). */
export const dnsRecords = (hostnames: readonly string[], tunnelId: string): DnsRecord[] =>
  hostnames.map((name) => ({ type: "CNAME", name, content: `${tunnelId}.cfargotunnel.com`, proxied: true }));

/** Hostnames of a finished job's dns step that still need a hand-made record, or [] (job page). */
export function manualDnsHosts(steps: readonly JobStep[]): string[] {
  const dns = steps.find((s) => s.key === "dns");
  const hosts = dns?.params?.hostnames;
  if (!dns?.code || !MANUAL_DNS_CODES.has(dns.code) || typeof hosts !== "string") return [];
  return hosts.split(", ").filter(Boolean);
}

const HTTP_SERVER_ERROR = 500;

/**
 * Site domains whose record the panel did not create and that do not answer from the internet yet (a working
 * domain already has its record). Until /domains has loaded every unmanaged domain counts.
 */
export function hostsNeedingRecord(
  dns: readonly { hostname: string; managed: boolean }[],
  domains?: readonly Domain[],
) {
  const status = new Map((domains ?? []).map((d) => [d.hostname, d.health.status]));
  return dns
    .filter((d) => !d.managed)
    .filter((d) => {
      const s = status.get(d.hostname);
      return s === undefined || s === null || s >= HTTP_SERVER_ERROR;
    })
    .map((d) => d.hostname);
}

/** One record as label/value pairs, labels always visible and never squeezed (QA fix-07 N6), same at every width. */
function RecordRow({ r }: { r: DnsRecord }) {
  const label = "whitespace-nowrap text-muted-foreground";
  const value = "flex min-w-0 items-center gap-1 font-mono text-[0.8125rem] break-all";
  return (
    <li className="flex flex-col gap-2 py-2">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
        <dt className={label}>{t.name}</dt>
        <dd className={value}>
          {r.name}
          <CopyButton value={r.name} label={t.copyName(r.name)} />
        </dd>
        <dt className={label}>{t.content}</dt>
        <dd className={value}>
          {r.content}
          <CopyButton value={r.content} label={t.copyContent} />
        </dd>
        <dt className={label}>{t.type}</dt>
        <dd>
          <span className="font-mono">{r.type}</span> · {t.proxy}: {t.proxyOn}
        </dd>
      </dl>
      <DomainCheckButton hostname={r.name} onChecked={() => {}} />
    </li>
  );
}

/**
 * The CNAME records to create in the Cloudflare dashboard while the panel has no API token, with a re-check per
 * domain and the way to a token. Renders nothing once a token is set. `open` = expanded (job page) or collapsed.
 */
export function DnsManualCard({ hostnames, open = false }: { hostnames: readonly string[]; open?: boolean }) {
  const integration = useApiQuery<Integration>(panelUrl("/integration"));
  const me = useMe();
  const info = integration.data;
  if (!info || info.cloudflareTokenSet) return null;
  const link = `inline-flex items-center gap-1 font-medium underline underline-offset-4 ${TOUCH_BOX}`;
  return (
    <details open={open} className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">{t.title(hostnames.length)}</summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-muted-foreground">{t.body}</p>
        {info.tunnelId ? (
          <ul className="flex flex-col divide-y">
            {dnsRecords(hostnames, info.tunnelId).map((r) => (
              <RecordRow key={r.name} r={r} />
            ))}
          </ul>
        ) : (
          <p className="text-warning">{t.noTunnel}</p>
        )}
        <p className="text-muted-foreground">{t.tokenHint}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <a className={link} href={CLOUDFLARE_TOKENS_URL} target="_blank" rel="noreferrer">
            {t.createToken}
            <ExternalLinkIcon className="size-3.5" aria-hidden />
          </a>
          {/* the settings page is super_admin's: an admin would be sent back to Ringkasan (QA fix-07 N7) */}
          {hasRole(me.role, "super_admin") && (
            <Link className={link} to={SETTINGS_TOKEN_PATH}>
              {t.openSettings}
            </Link>
          )}
        </p>
      </div>
    </details>
  );
}
