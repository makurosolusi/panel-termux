import { PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import type { Domain } from "@/shared/panel.types";
import type { HostnamesAddRequest, JobAccepted, SiteDetail } from "@/shared/site.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { Badge } from "@/web/components/ui/badge";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { panelUrl } from "@/web/panel/panel.api";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch, type ErrorCodes } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";
import { jobPath, siteUrl, useSiteCheck } from "./site.api";
import { HostLink } from "./site.card";
import {
  blinkingHosts,
  hostnameFeedback,
  hostnamesCheck,
  MAX_NEW_HOSTNAMES,
  normalizeHostnames,
} from "./site-detail.state";

const t = idSiteDetail.domains;

/** Domain list with DNS mode, remove (confirm; never the last one) and the add dialog; both open the job view. */
export function SiteHostnames({ site, busy, codes }: { site: SiteDetail; busy: boolean; codes: ErrorCodes }) {
  const navigate = useNavigate();
  const domains = useApiQuery<Domain[]>(panelUrl("/domains"), undefined, { enabled: false });
  const all = [...(domains.data ?? []).map((d) => d.hostname), ...site.hostnames];
  const dnsManaged = new Map(site.dns.map((d) => [d.hostname, d.managed]));
  const last = site.hostnames.length <= 1;
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
              title={t.removeTitle(h)}
              description={
                <>
                  <span>{t.removeBody}</span>
                  <span>{t.blip(blinkingHosts(all, [h]))}</span>
                  <span>{t.removeDnsNote}</span>
                </>
              }
              confirmLabel={idSiteDetail.domains.remove(h)}
              destructive
              codes={codes}
              onConfirm={() => start("DELETE", siteUrl(site.name, `/hostnames/${encodeURIComponent(h)}`))}
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
      <AddHostnamesDialog
        busy={busy}
        blinking={blinkingHosts(all)}
        codes={codes}
        onSubmit={(hostnames) => start("POST", siteUrl(site.name, "/hostnames"), { hostnames })}
      />
    </div>
  );
}

type AddProps = { busy: boolean; blinking: string[]; codes: ErrorCodes; onSubmit: (h: string[]) => Promise<unknown> };

/** "Tambah domain": 1–5 inputs with the live DNS check per domain and the named cloudflared blip. */
function AddHostnamesDialog({ busy, blinking, codes, onSubmit }: AddProps) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState([""]);
  const [pending, setPending] = useState(false);
  const hosts = normalizeHostnames(values);
  const check = useSiteCheck(open ? hostnamesCheck(hosts) : null);
  const ready = hosts.length > 0 && !check.checking && check.result?.ok === true && !pending && !busy;
  const submit = async () => {
    setPending(true);
    try {
      await onSubmit(hosts); // navigates to the job page
    } catch (err) {
      toast.error(apiErrorMessage(err, codes), { duration: ERROR_TOAST_MS });
      setPending(false);
    }
  };
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setValues([""]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="self-start" disabled={busy}>
          <PlusIcon aria-hidden />
          {t.add}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.addTitle}</DialogTitle>
          <DialogDescription>{t.addBody}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void submit();
          }}
        >
          {values.map((v, i) => {
            const fb = hostnameFeedback(check.result, v);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity besides their position
              <div key={i} className="flex flex-col gap-1">
                <div className="flex gap-2">
                  <Input
                    aria-label={t.field(i + 1)}
                    aria-invalid={fb?.blocking || undefined}
                    inputMode="url"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={t.placeholder}
                    value={v}
                    onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  {values.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t.removeRow(i + 1)}
                      onClick={() => setValues(values.filter((_, j) => j !== i))}
                    >
                      <XIcon aria-hidden />
                    </Button>
                  )}
                </div>
                {fb && (
                  <p className={fb.blocking ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{fb.text}</p>
                )}
              </div>
            );
          })}
          {values.length < MAX_NEW_HOSTNAMES && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => setValues([...values, ""])}
            >
              <PlusIcon aria-hidden />
              {t.addRow}
            </Button>
          )}
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {check.checking ? t.checking : check.error ? t.checkFailed : check.result?.ok ? t.available : ""}
          </p>
          <p className="rounded-md border border-warning/25 bg-warning-subtle px-3 py-2 text-xs text-warning">
            {t.blip(blinking)}
          </p>
          <DialogFooter>
            <Button type="submit" disabled={!ready}>
              {t.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
