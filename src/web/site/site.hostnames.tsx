import { Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { Domain } from "@/shared/panel.types";
import type { HostnamesAddRequest, JobAccepted, SiteDetail } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { panelUrl } from "@/web/panel/panel.api";
import { ApiError, apiFetch, type ErrorCodes } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";
import { DnsManualCard, hostsNeedingRecord } from "./dns.manual";
import { hostnameRemoveUrl, jobPath, siteUrl } from "./site.api";
import { HostLink } from "./site.card";
import { AddHostnamesDialog } from "./site.hostnames-add";
import { blinkingHosts } from "./site-detail.state";

const t = idSiteDetail.domains;

/**
 * Domain list with DNS mode, remove (confirm; a hand-written route needs the domain typed; never the last one) and the
 * add dialog; both open the job view.
 */
export function SiteHostnames({ site, busy, codes }: { site: SiteDetail; busy: boolean; codes: ErrorCodes }) {
  const navigate = useNavigate();
  const domains = useApiQuery<Domain[]>(panelUrl("/domains"), undefined, { enabled: false });
  const all = [...(domains.data ?? []).map((d) => d.hostname), ...site.hostnames];
  const dnsManaged = new Map(site.dns.map((d) => [d.hostname, d.managed]));
  const last = site.hostnames.length <= 1;
  // a 409 hand_written (the list was older than the config) turns that row's dialog into the typed tier
  const [sawHand, setSawHand] = useState<ReadonlySet<string>>(new Set());
  const hand = (h: string) => sawHand.has(h) || site.dns.some((d) => d.hostname === h && d.handWritten);
  const remove = async (h: string, typed?: string) => {
    try {
      await start("DELETE", hostnameRemoveUrl(site.name, h, typed));
    } catch (err) {
      if (err instanceof ApiError && err.code === "hand_written") setSawHand((p) => new Set(p).add(h));
      throw err;
    }
  };
  const needRecord = hostsNeedingRecord(site.dns, domains.data);
  const start = async (method: "POST" | "DELETE", url: string, body?: HostnamesAddRequest) =>
    navigate(jobPath((await apiFetch<JobAccepted>(method, url, body)).jobId));

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y rounded-md border px-3">
        {site.hostnames.map((h) => (
          <li key={h} className="flex min-h-12 flex-wrap items-center gap-2 py-2">
            <span className="mr-auto min-w-0">
              <HostLink host={h} />
            </span>
            <Badge variant="outline" className="font-normal">
              {dnsManaged.get(h) ? t.dnsManaged : t.dnsManual}
            </Badge>
            <ConfirmAction
              {...(hand(h) ? { tier: "typed" as const, typedValue: h } : { tier: "confirm" as const })}
              title={t.removeTitle(h)}
              description={
                <>
                  <span>{hand(h) ? t.removeHandBody : t.removeBody}</span>
                  <span>{t.blip(blinkingHosts(all, [h]))}</span>
                  <span>{t.removeDnsNote}</span>
                </>
              }
              confirmLabel={idSiteDetail.domains.remove(h)}
              destructive
              codes={codes}
              onConfirm={(typed) => remove(h, typed)}
              trigger={
                <Button variant="ghost" size="icon-sm" disabled={busy || last} aria-label={t.remove(h)}>
                  <Trash2Icon aria-hidden />
                </Button>
              }
            />
          </li>
        ))}
      </ul>
      {last && <p className="text-xs text-muted-foreground">{t.last}</p>}
      {needRecord.length > 0 && <DnsManualCard hostnames={needRecord} />}
      <AddHostnamesDialog
        busy={busy}
        blinking={blinkingHosts(all)}
        codes={codes}
        onSubmit={(hostnames) => start("POST", siteUrl(site.name, "/hostnames"), { hostnames })}
      />
    </div>
  );
}
