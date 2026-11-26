import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/web/components/ui/button";
import { Card, CardContent } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { panelUrl } from "@/web/panel/panel.api";
import { useApiQuery } from "@/web/shared/use-api-query";
import { jobPath, startJob, useSiteCheck } from "./site.api";
import { checkRequest, createBody, optionsReady, type SiteForm, targetReady } from "./site.check";
import { WizardOptions } from "./wizard.options";
import { WizardSummary } from "./wizard.summary";
import { WizardTarget } from "./wizard.target";

const t = id.site.wizard;
const EMPTY: SiteForm = { name: "", hostname: "", port: "", database: false, env: [] };

/** /panel/sites/new: 3-step create wizard (address → options → summary), then hands off to the job view. */
export function SiteNewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<SiteForm>(EMPTY);
  const [portTouched, setPortTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const suggested = useApiQuery<{ port: number }>(panelUrl("/sites/suggest-port"));
  const check = useSiteCheck(checkRequest(form));

  const suggestedPort = suggested.data?.port;
  useEffect(() => {
    if (suggestedPort !== undefined && !portTouched) setForm((f) => ({ ...f, port: String(suggestedPort) }));
  }, [suggestedPort, portTouched]);

  const patch = (p: Partial<SiteForm>) => {
    if ("port" in p) setPortTouched(true);
    setForm((f) => ({ ...f, ...p }));
  };
  const ready = [targetReady(form, check.result, check.checking), optionsReady(form), !submitting];

  const submit = async () => {
    setSubmitting(true);
    const jobId = await startJob("POST", panelUrl("/sites"), createBody(form));
    setSubmitting(false);
    if (jobId) navigate(jobPath(jobId));
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Link to="/panel/sites" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeftIcon className="size-4" aria-hidden />
        {id.site.detail.back}
      </Link>
      <h1 className="text-lg font-semibold">{t.title}</h1>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t.stepOf(step + 1, t.steps.length, t.steps[step] ?? "")}
      </p>
      <Card className="py-4">
        <CardContent className="px-4">
          <form
            className="flex flex-col gap-6"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ready[step]) return;
              if (step < 2) setStep(step + 1);
              else void submit();
            }}
          >
            {step === 0 && <WizardTarget form={form} onChange={patch} check={check} />}
            {step === 1 && <WizardOptions form={form} onChange={patch} />}
            {step === 2 && <WizardSummary body={createBody(form)} />}
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" disabled={step === 0} onClick={() => setStep(step - 1)}>
                {t.back}
              </Button>
              <Button type="submit" disabled={!ready[step]}>
                {step < 2 ? t.next : t.create}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
