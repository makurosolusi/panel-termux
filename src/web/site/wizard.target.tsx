import { CheckCircle2Icon, LoaderIcon } from "lucide-react";
import type { SiteCheckResult } from "@/shared/site.types";
import { Input } from "@/web/components/ui/input";
import { id } from "@/web/i18n/id";
import { FormField } from "./form.field";
import { issuesByField, parsePort, type SiteForm } from "./site.check";

const t = id.site.wizard;

/** Wizard step 1: name, hostname, port, with the live check's per-field issues under each input. */
export function WizardTarget({
  form,
  onChange,
  check,
}: {
  form: SiteForm;
  onChange: (patch: Partial<SiteForm>) => void;
  check: { result: SiteCheckResult | undefined; error: string | undefined; checking: boolean };
}) {
  const issues = issuesByField(check.result?.issues ?? []);
  const portErrors = parsePort(form.port) === "invalid" ? [t.portInvalid] : issues.port;
  const invalid = (errs?: string[]) => (errs && errs.length > 0 ? true : undefined);
  return (
    <div className="flex flex-col gap-4">
      <FormField id="site-name" label={t.name} hint={t.nameHint} errors={issues.name}>
        <Input
          id="site-name"
          autoFocus
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={invalid(issues.name)}
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </FormField>
      <FormField id="site-hostname" label={t.hostname} errors={issues.hostname}>
        <Input
          id="site-hostname"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t.hostnamePlaceholder}
          aria-invalid={invalid(issues.hostname)}
          value={form.hostname}
          onChange={(e) => onChange({ hostname: e.target.value })}
        />
      </FormField>
      <FormField id="site-port" label={t.port} hint={t.portHint} errors={portErrors}>
        <Input
          id="site-port"
          inputMode="numeric"
          className="w-32"
          aria-invalid={invalid(portErrors)}
          value={form.port}
          onChange={(e) => onChange({ port: e.target.value })}
        />
      </FormField>
      <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {check.checking && (
          <>
            <LoaderIcon className="size-4 animate-spin" aria-hidden />
            {t.checking}
          </>
        )}
        {check.result?.ok && (
          <>
            <CheckCircle2Icon className="size-4 text-emerald-600" aria-hidden />
            {t.available}
          </>
        )}
        {check.error && <span className="text-destructive">{check.error}</span>}
      </p>
    </div>
  );
}
