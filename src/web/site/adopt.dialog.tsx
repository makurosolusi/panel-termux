import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import type { AdoptCandidateApp, DiscoveredIngress, SiteDetail } from "@/shared/site.types";
import { CodeText } from "@/web/components/code-text";
import { KeyValue } from "@/web/components/key-value";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { Input } from "@/web/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { idSite } from "@/web/i18n/id.site";
import { panelUrl } from "@/web/panel/panel.api";
import { apiFetch } from "@/web/shared/api.client";
import { useReturnFocus } from "@/web/shared/focus.return";
import { FormField } from "./form.field";
import { type AdoptForm, adoptBody, adoptOptions, adoptPrefill, appFacts, appWarnings } from "./site.adopt";
import { runSiteAction } from "./site.api";

const t = idSite.adopt;
/** Centered dialog from `sm` up; below it a bottom sheet with the safe-area inset (PLAN/03 §6). */
export const PHONE_SHEET =
  "max-h-[90dvh] overflow-y-auto max-sm:top-auto max-sm:bottom-0 max-sm:max-w-full max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-xl max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:slide-in-from-bottom";

/** Adopt dialog for `entry` (closed when null). `onDone(name)` after 201; `onFailed` so the caller reloads its list. */
export function AdoptDialog({
  entry,
  apps,
  onClose,
  onDone,
  onFailed,
}: {
  entry: DiscoveredIngress | null;
  apps: readonly AdoptCandidateApp[];
  onClose: () => void;
  onDone: (name: string) => void;
  onFailed: () => void;
}) {
  const returnFocus = useReturnFocus(entry !== null);
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={PHONE_SHEET} onCloseAutoFocus={returnFocus}>
        {entry && <AdoptFormBody key={entry.hostname} entry={entry} apps={apps} onDone={onDone} onFailed={onFailed} />}
      </DialogContent>
    </Dialog>
  );
}

function AdoptFormBody({
  entry,
  apps,
  onDone,
  onFailed,
}: {
  entry: DiscoveredIngress;
  apps: readonly AdoptCandidateApp[];
  onDone: (name: string) => void;
  onFailed: () => void;
}) {
  const [form, setForm] = useState<AdoptForm>(() => adoptPrefill(entry, apps));
  const [pending, setPending] = useState(false);
  const options = adoptOptions(apps);
  const blocked = options.filter((o) => o.disabled);
  const app = apps.find((a) => a.name === form.app);
  const body = adoptBody(entry.hostname, form, apps);

  const submit = async () => {
    if (!body) return;
    setPending(true);
    const ok = await runSiteAction(
      () => apiFetch<SiteDetail>("POST", panelUrl("/sites/adopt"), body),
      t.done(body.name),
    );
    setPending(false);
    if (ok) onDone(body.name);
    else onFailed();
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
      <FormField id="adopt-app" label={t.app}>
        <Select
          value={form.app}
          onValueChange={(name) => setForm({ app: name, name: form.name === form.app ? name : form.name })}
        >
          <SelectTrigger id="adopt-app" className="w-full">
            <SelectValue placeholder={t.appPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.name} value={o.name} disabled={o.disabled}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {blocked.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {blocked.map((o) => (
              <li key={o.name}>
                <span className="font-mono">{o.name}</span>: <CodeText>{o.reason ?? ""}</CodeText>
              </li>
            ))}
          </ul>
        )}
      </FormField>
      <FormField id="adopt-name" label={t.name} hint={t.nameHint}>
        <Input
          id="adopt-name"
          autoCapitalize="none"
          spellCheck={false}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </FormField>
      {app && (
        <>
          <KeyValue
            items={[
              { label: t.folder, value: appFacts(app).folder, mono: true },
              { label: t.runtime, value: appFacts(app).runtime },
              { label: t.port, value: <CodeText>{appFacts(app).port}</CodeText> },
            ]}
          />
          {appWarnings(app).map((w) => (
            <p key={w} className="flex items-start gap-2 text-sm">
              <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <CodeText>{w}</CodeText>
            </p>
          ))}
        </>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending || !body}>
          {t.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}
