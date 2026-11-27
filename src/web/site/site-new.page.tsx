import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { Integration, Site } from "@/shared/site.types";
import { ActionBar } from "@/web/components/action-bar";
import { PageHeader } from "@/web/components/page-header";
import { Button } from "@/web/components/ui/button";
import { idSite } from "@/web/i18n/id.site";
import { panelUrl } from "@/web/panel/panel.api";
import { useApiQuery } from "@/web/shared/use-api-query";
import { IntegrationBanner } from "./integration.banner";
import { integrationReady } from "./site.adopt";
import { jobPath, startJob, useSiteCheck } from "./site.api";
import {
  blipHosts,
  checkRequest,
  createBody,
  EMPTY_SITE_FORM,
  optionsReady,
  type SiteForm,
  targetReady,
  wizardDns,
} from "./site.check";
import { WizardOptions } from "./wizard.options";
import { WizardSummary } from "./wizard.summary";
import { WizardTarget } from "./wizard.target";

const t = idSite.wizard;
const LAST_STEP = t.steps.length - 1;

/** Step list; the current one carries `aria-current="step"`. */
function Stepper({ step }: { step: number }) {
  return (
    <ol aria-label={t.stepsLabel} className="mb-6 flex gap-2 text-sm">
      {t.steps.map((label, i) => (
        <li
          key={label}
          aria-current={i === step ? "step" : undefined}
          className={cn(
            "flex flex-1 flex-col gap-1.5 border-t-2 pt-2",
            i <= step ? "border-brand text-foreground" : "border-border text-muted-foreground",
          )}
        >
          <span className="text-xs tabular-nums text-muted-foreground">{i + 1}</span>
          <span className={cn(i === step && "font-medium")}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

/** /panel/sites/new: 3-step create wizard (Alamat → Opsi → Ringkasan), then hands off to the job page. */
export function SiteNewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<SiteForm>(EMPTY_SITE_FORM);
  const [portTouched, setPortTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const suggested = useApiQuery<{ port: number }>(panelUrl("/sites/suggest-port"));
  const integration = useApiQuery<Integration>(panelUrl("/integration"));
  const sites = useApiQuery<Site[]>(panelUrl("/sites"));
  const check = useSiteCheck(checkRequest(form));

  // Move focus to the step heading when the step changes (not on first render), so screen readers hear the new step.
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    stepHeading.current?.focus();
  }, [step]);

  const suggestedPort = suggested.data?.port;
  useEffect(() => {
    if (suggestedPort !== undefined && !portTouched) setForm((f) => ({ ...f, port: String(suggestedPort) }));
  }, [suggestedPort, portTouched]);

  const patch = (p: Partial<SiteForm>) => {
    if ("port" in p) setPortTouched(true);
    setForm((f) => ({ ...f, ...p }));
  };
  const ready = integration.data ? integrationReady(integration.data) : false;
  const dns = wizardDns(integration.data);
  const body = createBody(form);
  const hosts = blipHosts(
    (sites.data ?? []).flatMap((s) => s.hostnames),
    globalThis.location?.hostname ?? "",
    [body.hostname, ...(body.extraHostnames ?? [])],
  );
  const canGo = [targetReady(form, check.result, check.checking), optionsReady(form), ready && !submitting];

  const submit = async () => {
    setSubmitting(true);
    const jobId = await startJob("POST", panelUrl("/sites"), body);
    setSubmitting(false);
    if (jobId) navigate(jobPath(jobId));
  };

  return (
    <div className="flex max-w-2xl flex-col">
      <PageHeader title={t.title} description={t.description} back={{ to: "/panel/sites", label: idSite.list.title }} />
      <Stepper step={step} />
      <h2 ref={stepHeading} tabIndex={-1} className="sr-only">
        {t.stepOf(step + 1, t.steps.length, t.steps[step] ?? "")}
      </h2>
      {integration.data && !ready && <IntegrationBanner />}
      <form
        className="mt-4 flex flex-col gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!canGo[step]) return;
          if (step < LAST_STEP) setStep(step + 1);
          else void submit();
        }}
      >
        {step === 0 && <WizardTarget form={form} onChange={patch} check={check} />}
        {step === 1 && <WizardOptions form={form} onChange={patch} />}
        {step === 2 && <WizardSummary body={body} dns={dns} blipHosts={hosts} />}
        <ActionBar>
          <Button
            type="button"
            variant="outline"
            onClick={() => (step === 0 ? navigate("/panel/sites") : setStep(step - 1))}
          >
            {step === 0 ? t.cancel : t.back}
          </Button>
          <Button type="submit" disabled={!canGo[step]}>
            {step < LAST_STEP ? t.next : t.create}
          </Button>
        </ActionBar>
      </form>
    </div>
  );
}
