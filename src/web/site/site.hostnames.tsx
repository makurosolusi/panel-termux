import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { SiteDetail } from "@/shared/site.types";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { id } from "@/web/i18n/id";
import { ConfirmDelete } from "@/web/shared/confirm.dialog";
import { jobPath, siteUrl, startJob } from "./site.api";
import { HostLink } from "./site.card";

const t = id.site.detail;

/** Hostnames of a site with DNS mode, remove (not the last one) and add; both changes open the job view. */
export function SiteHostnames({ site }: { site: SiteDetail }) {
  const navigate = useNavigate();
  const [host, setHost] = useState("");
  const [pending, setPending] = useState(false);
  const dnsManaged = new Map(site.dns.map((d) => [d.hostname, d.managed]));

  const run = async (method: "POST" | "DELETE", url: string, body?: unknown) => {
    setPending(true);
    const jobId = await startJob(method, url, body);
    setPending(false);
    if (jobId) navigate(jobPath(jobId));
  };
  const last = site.hostnames.length <= 1;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y">
        {site.hostnames.map((h) => (
          <li key={h} className="flex items-center gap-2 py-2">
            <span className="mr-auto min-w-0">
              <HostLink host={h} />
            </span>
            <Badge variant="outline">{dnsManaged.get(h) ? t.dnsManaged : t.dnsManual}</Badge>
            <span title={last ? t.lastHostname : undefined}>
              <ConfirmDelete
                label={t.removeHostname(h)}
                title={t.removeHostnameTitle(h)}
                description={
                  <>
                    <span>{t.removeHostnameBody}</span>
                    <span>{id.site.wizard.blinkWarning}</span>
                  </>
                }
                disabled={pending || last}
                onConfirm={() => void run("DELETE", siteUrl(site.name, `/hostnames/${encodeURIComponent(h)}`))}
              />
            </span>
          </li>
        ))}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const hostname = host.trim().toLowerCase();
          if (hostname) void run("POST", siteUrl(site.name, "/hostnames"), { hostname });
        }}
      >
        <Input
          aria-label={t.addHostname}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t.addHostnamePlaceholder}
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={pending || host.trim() === ""}>
          <PlusIcon aria-hidden />
          <span className="sr-only sm:not-sr-only">{t.addHostname}</span>
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{id.site.wizard.blinkWarning}</p>
    </div>
  );
}
