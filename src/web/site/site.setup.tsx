import { CircleCheckIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { hasRole } from "@/shared/roles";
import type { Integration, IntegrationCheck } from "@/shared/site.types";
import { CopyButton } from "@/web/components/copy-button";
import { InlineCode } from "@/web/components/inline-code";
import { RelativeTime } from "@/web/components/relative-time";
import type { StatusKey } from "@/web/components/status.vocab";
import { StatusBadge } from "@/web/components/status-badge";
import { StatusIcon } from "@/web/components/status-icon";
import { Button } from "@/web/components/ui/button";
import { idSite } from "@/web/i18n/id.site";
import { panelUrl } from "@/web/panel/panel.api";
import { useMe } from "@/web/session/use-me";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch } from "@/web/shared/api.client";
import { checkText, editCommand, failingChecks, oldSnippet, setupNeeded, snippetNeeded } from "./site.adopt";
import { SITE_ERROR_CODES } from "./site.api";

const t = idSite.setup;
const CHECK_STATE: Record<IntegrationCheck["state"], StatusKey> = { ok: "done", warning: "attention", error: "failed" };

/** Copy text with `backtick` spans rendered as inline code (file names, commands). */
export function CodeText({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string, never reordered
          <code key={i} className="rounded bg-muted px-1 font-mono text-[0.8125em]">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** Code block with a copy button in its corner. */
function CodeBlock({ code, copyLabel }: { code: string; copyLabel?: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-md border bg-muted p-3 pr-10 font-mono text-xs leading-relaxed">
        {code}
      </pre>
      {copyLabel && (
        <div className="absolute top-2 right-2">
          <CopyButton value={code} label={copyLabel} />
        </div>
      )}
    </div>
  );
}

function Checklist({ checks }: { checks: IntegrationCheck[] }) {
  const me = useMe();
  return (
    <ul aria-label={t.checklist} className="flex flex-col gap-2 text-sm">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2">
          <StatusIcon state={CHECK_STATE[c.state]} className="mt-0.5" />
          <span className={c.state === "ok" ? "text-muted-foreground" : undefined}>
            <CodeText text={checkText(c)} />
            {c.key === "cloudflare_token" && c.state !== "ok" && hasRole(me.role, "super_admin") && (
              <>
                {" "}
                <Link to="/dev/settings" className="font-medium underline underline-offset-2">
                  {t.tokenLink}
                </Link>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SnippetSteps({ integration }: { integration: Integration }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{t.stepsTitle}</h3>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm marker:text-muted-foreground">
        <li className="flex flex-col gap-1.5">
          {t.step1}
          <InlineCode copy>{editCommand(integration)}</InlineCode>
        </li>
        <li className="flex flex-col gap-1.5">
          <CodeText text={t.step2} />
          {integration.snippet && <CodeBlock code={integration.snippet} copyLabel={t.copySnippet} />}
          {oldSnippet(integration) && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge tone="warning" label={t.oldSnippet} />
              <CodeText text={t.oldSnippetBody} />
            </p>
          )}
        </li>
        <li className="flex flex-col gap-1.5">
          <CodeText text={t.step3} />
          <CodeBlock code={t.exampleExports} />
        </li>
        <li>{t.step4}</li>
      </ol>
      <p className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-subtle p-3 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <CodeText text={t.warning} />
      </p>
    </div>
  );
}

/**
 * Persiapan card (PLAN/03 §5.1): checklist, the safe apps.json snippet with steps, "Periksa lagi". Collapses to one
 * success line once pm2 is ready without warnings. `adoptable` = unmanaged domains that can be adopted now.
 */
export function SiteSetup({
  integration,
  adoptable,
  onVerified,
}: {
  integration: Integration;
  adoptable: number;
  onVerified: () => void;
}) {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState("");

  const verify = async () => {
    setVerifying(true);
    setResult("");
    try {
      const fresh = await apiFetch<Integration>("POST", panelUrl("/integration/verify"));
      const errors = failingChecks(fresh).filter((c) => c.state === "error").length;
      setResult(errors ? t.stillFailing(errors) : t.allOk);
    } catch (err) {
      toast.error(apiErrorMessage(err, SITE_ERROR_CODES), { duration: ERROR_TOAST_MS });
    } finally {
      setVerifying(false);
      onVerified();
    }
  };

  if (!setupNeeded(integration)) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleCheckIcon className="size-4 text-success" aria-hidden />
        {t.readyLine(integration.appNames?.length ?? 0)}
      </p>
    );
  }

  return (
    <section aria-labelledby="setup-title" className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="setup-title" className="text-base font-semibold">
            {t.title}
          </h2>
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{t.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {integration.checkedAt && (
            <span className="text-xs text-muted-foreground">
              <RelativeTime at={integration.checkedAt} format={t.checkedAt} />
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => void verify()} disabled={verifying}>
            <RefreshCwIcon className={verifying ? "motion-safe:animate-spin" : undefined} aria-hidden />
            {verifying ? t.checking : t.recheck}
          </Button>
        </div>
      </div>
      <p aria-live="polite" className="text-sm font-medium empty:hidden">
        {result}
      </p>
      <Checklist checks={integration.checks ?? []} />
      {snippetNeeded(integration) && <SnippetSteps integration={integration} />}
      {adoptable > 0 && (
        <div className="flex flex-col gap-1 border-t pt-3 text-sm">
          <h3 className="font-semibold">{t.adoptTitle}</h3>
          <p className="text-muted-foreground">{t.adoptBody(adoptable)}</p>
          <a href="#belum-dikelola" className="w-fit font-medium underline underline-offset-2">
            {t.adoptLink}
          </a>
        </div>
      )}
    </section>
  );
}
