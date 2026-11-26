import { useState } from "react";
import type { DiscoveredIngress, Site } from "@/shared/site.types";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { id } from "@/web/i18n/id";
import { panelUrl } from "@/web/panel/panel.api";
import { apiFetch } from "@/web/shared/api.client";
import { FormField } from "./form.field";
import { type AdoptForm, adoptBody, adoptPrefill } from "./site.adopt";
import { runSiteAction } from "./site.api";

const t = id.site.adopt;

/** Adopt dialog for `entry` (closed when null); calls `onAdopted` after a successful POST /sites/adopt. */
export function AdoptDialog({
  entry,
  onClose,
  onAdopted,
}: {
  entry: DiscoveredIngress | null;
  onClose: () => void;
  onAdopted: () => void;
}) {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>{entry && <AdoptFormBody key={entry.hostname} entry={entry} onDone={onAdopted} />}</DialogContent>
    </Dialog>
  );
}

function AdoptFormBody({ entry, onDone }: { entry: DiscoveredIngress; onDone: () => void }) {
  const [form, setForm] = useState<AdoptForm>(() => adoptPrefill(entry));
  const [pending, setPending] = useState(false);
  const body = adoptBody(form);
  const set = (k: keyof AdoptForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    if (!body) return;
    setPending(true);
    const ok = await runSiteAction(() => apiFetch<Site>("POST", panelUrl("/sites/adopt"), body), t.done(body.name));
    setPending(false);
    if (ok) onDone();
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t.title(entry.hostname)}</DialogTitle>
        <DialogDescription>{t.description}</DialogDescription>
      </DialogHeader>
      <FormField id="adopt-name" label={t.name}>
        <Input id="adopt-name" autoFocus value={form.name} placeholder={t.namePlaceholder} onChange={set("name")} />
      </FormField>
      <FormField id="adopt-hostname" label={t.hostname}>
        <Input id="adopt-hostname" value={form.hostname} onChange={set("hostname")} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField id="adopt-port" label={t.port}>
          <Input id="adopt-port" inputMode="numeric" value={form.port} onChange={set("port")} />
        </FormField>
        <FormField id="adopt-app" label={t.app}>
          <Input id="adopt-app" value={form.app} onChange={set("app")} />
        </FormField>
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending || !body}>
          {t.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
