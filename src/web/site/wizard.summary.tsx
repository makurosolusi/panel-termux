import { AlertTriangleIcon, CheckIcon } from "lucide-react";
import type { SiteCreateRequest } from "@/shared/site.types";
import { id } from "@/web/i18n/id";

const p = id.site.wizard.plan;

/** Ordered list of what creating `body` will do (mirrors the server's job steps). */
export function createPlan(body: SiteCreateRequest): string[] {
  const envCount = Object.keys(body.env ?? {}).length;
  return [
    p.folder(body.name),
    body.database ? p.database(body.name) : p.noDatabase,
    p.env(envCount),
    ...(body.database ? [p.envDb] : []),
    p.appsJson(body.name, body.port ?? null),
    p.routing(body.hostname),
    p.dns(body.hostname),
    p.restart,
  ];
}

/** Wizard step 3: the plan and the "all domains blink" warning. */
export function WizardSummary({ body }: { body: SiteCreateRequest }) {
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-medium">{id.site.wizard.summary}</h2>
      <ol className="flex flex-col gap-2 text-sm">
        {createPlan(body).map((line) => (
          <li key={line} className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            {line}
          </li>
        ))}
      </ol>
      <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
        <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        {id.site.wizard.blinkWarning}
      </p>
    </div>
  );
}
