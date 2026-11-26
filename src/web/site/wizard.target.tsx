import { CircleCheckIcon, InfoIcon, LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react";
import { Link } from "react-router";
import type { SiteCheckResult } from "@/shared/site.types";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { idSite } from "@/web/i18n/id.site";
import { FormField } from "./form.field";
import { jobPath } from "./site.api";
import { cleanHost, MAX_HOSTNAMES, notesByHost, parsePort, type SiteForm, targetIssues } from "./site.check";

const t = idSite.wizard;

type Check = { result: SiteCheckResult | undefined; error: string | undefined; checking: boolean };

/** Accessible error wiring of one input. */
const invalidProps = (id: string, errors: readonly string[]) =>
  errors.length > 0 ? { "aria-invalid": true, "aria-describedby": `${id}-errors` } : {};

/** One domain input (+ remove for extra rows) with its issues and DNS notes. */
function HostnameRow(props: {
  index: number;
  value: string;
  errors: string[];
  notes: string[];
  onChange: (v: string) => void;
  onRemove?: () => void;
}) {
  const id = `site-hostname-${props.index}`;
  const label = props.index === 0 ? t.hostname : t.hostnameExtra(props.index);
  return (
    <FormField id={id} label={label} errors={props.errors}>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={t.hostnamePlaceholder}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={(e) => props.onChange(cleanHost(e.target.value))}
          {...invalidProps(id, props.errors)}
        />
        {props.onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t.removeHostname(props.value)}
            onClick={props.onRemove}
          >
            <XIcon aria-hidden />
          </Button>
        )}
      </div>
      {props.notes.map((n) => (
        <p key={n} className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="mt-px size-3.5 shrink-0 text-info" aria-hidden />
          {n}
        </p>
      ))}
    </FormField>
  );
}

/** Wizard step 1 (Alamat): name, 1–5 domains, port; live debounced check with coded issues per field. */
export function WizardTarget({
  form,
  onChange,
  check,
}: {
  form: SiteForm;
  onChange: (patch: Partial<SiteForm>) => void;
  check: Check;
}) {
  const issues = targetIssues(check.result);
  const notes = notesByHost(check.result);
  const portErrors = parsePort(form.port) === "invalid" ? [t.portInvalid] : issues.port;
  const setHost = (i: number, v: string) => onChange({ hostnames: form.hostnames.map((h, j) => (j === i ? v : h)) });

  return (
    <div className="flex flex-col gap-5">
      <FormField id="site-name" label={t.name} hint={t.nameHint} errors={issues.name}>
        <Input
          id="site-name"
          autoFocus
          autoCapitalize="none"
          spellCheck={false}
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          {...invalidProps("site-name", issues.name)}
        />
        {issues.leftoverJobId && (
          <Link to={jobPath(issues.leftoverJobId)} className="w-fit text-xs font-medium underline underline-offset-2">
            {t.recover}
          </Link>
        )}
      </FormField>
      <div className="flex flex-col gap-3">
        {form.hostnames.map((h, i) => (
          <HostnameRow
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional (primary + extras), edited in place
            key={i}
            index={i}
            value={h}
            errors={issues.hostnames[cleanHost(h)] ?? []}
            notes={notes[cleanHost(h)] ?? []}
            onChange={(v) => setHost(i, v)}
            onRemove={i === 0 ? undefined : () => onChange({ hostnames: form.hostnames.filter((_, j) => j !== i) })}
          />
        ))}
        {form.hostnames.length < MAX_HOSTNAMES && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-fit"
            onClick={() => onChange({ hostnames: [...form.hostnames, ""] })}
          >
            <PlusIcon aria-hidden />
            {t.addHostname}
          </Button>
        )}
      </div>
      <FormField id="site-port" label={t.port} hint={t.portHint} errors={portErrors}>
        <Input
          id="site-port"
          inputMode="numeric"
          className="w-32"
          value={form.port}
          onChange={(e) => onChange({ port: e.target.value })}
          {...invalidProps("site-port", portErrors)}
        />
      </FormField>
      <p className="flex min-h-5 items-center gap-2 text-sm" aria-live="polite">
        {check.checking && (
          <>
            <LoaderCircleIcon className="size-4 text-muted-foreground motion-safe:animate-spin" aria-hidden />
            <span className="text-muted-foreground">{t.checking}</span>
          </>
        )}
        {check.result?.ok && (
          <>
            <CircleCheckIcon className="size-4 text-success" aria-hidden />
            {t.available}
          </>
        )}
        {check.error && <span className="text-danger">{check.error}</span>}
      </p>
    </div>
  );
}
