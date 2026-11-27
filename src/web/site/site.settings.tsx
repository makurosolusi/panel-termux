import { SaveIcon } from "lucide-react";
import { useId, useState } from "react";
import {
  HEALTH_TIMEOUT_MAX_SEC as MAX,
  HEALTH_TIMEOUT_MIN_SEC as MIN,
  type SiteDetail,
  type SiteSettingsUpdate,
} from "@/shared/site.types";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { Label } from "@/web/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { tSiteDetail } from "@/web/i18n/en.site-detail";
import { runApiAction } from "@/web/shared/api.action";
import { apiFetch, type ErrorCodes } from "@/web/shared/api.client";
import { siteUrl } from "./site.api";
import { type HealthForm, healthForm, healthFormErrors, healthOf, healthPatch } from "./site-detail.state";

const t = tSiteDetail.settings;

/** Health check settings of a site (path, expected status, timeout 10–300 s) → PATCH /sites/:name/settings. */
export function SiteSettings({
  site,
  busy,
  codes,
  onSaved,
}: {
  site: SiteDetail;
  busy: boolean;
  codes: ErrorCodes;
  onSaved: () => void;
}) {
  const current = healthOf(site);
  const [form, setForm] = useState<HealthForm>(() => healthForm(current));
  const [pending, setPending] = useState(false);
  const ids = useId();
  const errors = healthFormErrors(form);
  const patch = healthPatch(form, current);
  const set = (p: Partial<HealthForm>) => setForm({ ...form, ...p });

  const save = async () => {
    if (!patch) return;
    setPending(true);
    const ok = await runApiAction(
      () => apiFetch("PATCH", siteUrl(site.name, "/settings"), patch satisfies SiteSettingsUpdate),
      t.saved,
      codes,
    );
    setPending(false);
    if (ok) onSaved();
  };

  return (
    <form
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-path`}>{t.path}</Label>
        <Input
          id={`${ids}-path`}
          className="font-mono"
          autoCapitalize="none"
          spellCheck={false}
          value={form.path}
          aria-invalid={errors.path}
          aria-describedby={`${ids}-path-hint`}
          onChange={(e) => set({ path: e.target.value })}
        />
        <p id={`${ids}-path-hint`} className={errors.path ? "text-xs text-danger" : "text-xs text-muted-foreground"}>
          {errors.path ? t.errors.path : t.pathHint}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-expect`}>{t.expect}</Label>
        <Select value={form.expect} onValueChange={(v) => set({ expect: v as HealthForm["expect"] })}>
          <SelectTrigger id={`${ids}-expect`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(t.expects) as HealthForm["expect"][]).map((k) => (
              <SelectItem key={k} value={k}>
                {t.expects[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-timeout`}>{t.timeout}</Label>
        <Input
          id={`${ids}-timeout`}
          type="number"
          inputMode="numeric"
          min={MIN}
          max={MAX}
          value={form.timeout}
          aria-invalid={errors.timeout}
          aria-describedby={`${ids}-timeout-hint`}
          onChange={(e) => set({ timeout: e.target.value })}
        />
        <p
          id={`${ids}-timeout-hint`}
          className={errors.timeout ? "text-xs text-danger" : "text-xs text-muted-foreground"}
        >
          {errors.timeout ? t.errors.timeout(MIN, MAX) : t.timeoutHint(MIN, MAX)}
        </p>
      </div>
      <Button
        type="submit"
        variant="outline"
        className="sm:col-span-3 sm:justify-self-start"
        disabled={!patch || pending || busy}
      >
        <SaveIcon aria-hidden />
        {t.save}
      </Button>
    </form>
  );
}
