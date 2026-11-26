import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, type ErrorCodes } from "@/web/shared/api.client";
import { useSiteCheck } from "./site.api";
import { cleanHost } from "./site.check";
import { hostnameFeedback, hostnamesCheck, MAX_NEW_HOSTNAMES, normalizeHostnames } from "./site-detail.state";

const t = idSiteDetail.domains;

type AddProps = { busy: boolean; blinking: string[]; codes: ErrorCodes; onSubmit: (h: string[]) => Promise<unknown> };

/** "Tambah domain": 1–5 inputs with the live DNS check per domain and the named cloudflared blip. */
export function AddHostnamesDialog({ busy, blinking, codes, onSubmit }: AddProps) {
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
                    aria-describedby={fb ? `add-host-fb-${i}` : undefined}
                    inputMode="url"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={t.placeholder}
                    value={v}
                    onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))}
                    onBlur={(e) => setValues(values.map((x, j) => (j === i ? cleanHost(e.target.value) : x)))}
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
                  <p
                    id={`add-host-fb-${i}`}
                    className={fb.blocking ? "text-xs text-danger" : "text-xs text-muted-foreground"}
                  >
                    {fb.text}
                  </p>
                )}
              </div>
            );
          })}
          <p aria-live="polite" className="text-xs text-muted-foreground">
            {check.checking ? t.checking : check.error ? t.checkFailed : check.result?.ok ? t.available : ""}
          </p>
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
