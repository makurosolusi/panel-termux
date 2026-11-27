import { Label } from "@/web/components/ui/label";
import { Switch } from "@/web/components/ui/switch";
import { tSite } from "@/web/i18n/en.site";
import { EnvRowsEditor } from "./env.editor";
import type { SiteForm } from "./site.check";

const t = tSite.wizard;

/** Wizard step 2: database toggle and extra env rows. */
export function WizardOptions({ form, onChange }: { form: SiteForm; onChange: (patch: Partial<SiteForm>) => void }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-3">
        <Switch id="site-db" checked={form.database} onCheckedChange={(database) => onChange({ database })} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="site-db">{t.database}</Label>
          <p className="text-xs text-muted-foreground">{t.databaseHint}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t.env}</h2>
        <p className="text-xs text-muted-foreground">{t.envHint}</p>
        <EnvRowsEditor rows={form.env} onChange={(env) => onChange({ env })} />
      </div>
    </div>
  );
}
