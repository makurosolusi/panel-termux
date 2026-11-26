import { CircleDashedIcon, TriangleAlertIcon } from "lucide-react";
import type { SiteCreateRequest } from "@/shared/site.types";
import { idSite } from "@/web/i18n/id.site";
import { createPlan } from "./site.check";

const t = idSite.wizard;

/** Wizard step 3 (Ringkasan): the job's steps in order, the named cloudflared blip, and what comes after. */
export function WizardSummary({
  body,
  tokenSet,
  blipHosts,
}: {
  body: SiteCreateRequest;
  tokenSet: boolean;
  blipHosts: string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">{t.summary}</h2>
      <ol className="flex flex-col gap-2 text-sm">
        {createPlan(body, tokenSet).map((line) => (
          <li key={line} className="flex items-start gap-2">
            <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {line}
          </li>
        ))}
      </ol>
      <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-subtle p-3 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        {t.blip(blipHosts)}
      </p>
      <p className="text-sm text-muted-foreground">{t.after}</p>
    </div>
  );
}
