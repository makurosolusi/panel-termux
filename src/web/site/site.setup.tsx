import { CircleCheckIcon, InfoIcon, RefreshCwIcon, WrenchIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { toast } from "sonner";
import type { FixKey } from "@/shared/fix.types";
import type { Integration } from "@/shared/site.types";
import { RelativeTime } from "@/web/components/relative-time";
import { Button } from "@/web/components/ui/button";
import { idSite } from "@/web/i18n/id.site";
import { panelUrl } from "@/web/panel/panel.api";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch } from "@/web/shared/api.client";
import { SetupActions } from "./setup.actions";
import { SetupChecklist } from "./setup.checklist";
import { SetupManual } from "./setup.manual";
import { applicableFixes, checkText, failingChecks, pm2Pending, setupNeeded } from "./site.adopt";
import { SITE_ERROR_CODES } from "./site.api";

// preview dialog + diff only load when Perbaiki is pressed (bundle budget, PLAN/06 §4.1)
const FixDialog = lazy(() => import("./fix.dialog").then((m) => ({ default: m.FixDialog })));

const t = idSite.setup;
/** Anchor of the card (onboarding "Perbaiki di Situs" links to /panel/sites#persiapan). */
const SETUP_ANCHOR = "persiapan";

/** One line once pm2 is ready, plus the pending pm2 note and the undo/restart details. */
function ReadyLine({ integration, onVerified }: { integration: Integration; onVerified: () => void }) {
  const pending = integration.checks?.find((c) => c.key === "pm2_auto_exit");
  return (
    <div id={SETUP_ANCHOR} className="flex scroll-mt-20 flex-col gap-1.5 text-sm text-muted-foreground">
      <p className="flex items-center gap-2">
        <CircleCheckIcon className="size-4 text-success" aria-hidden />
        {t.readyLine(integration.appNames?.length ?? 0)}
      </p>
      {pending && pm2Pending(integration) && (
        <p className="flex items-center gap-2">
          <InfoIcon className="size-4 text-info" aria-hidden />
          {checkText(pending)}
        </p>
      )}
      <SetupActions integration={integration} onChange={onVerified} />
    </div>
  );
}

/**
 * Persiapan card (PLAN/03 §5.1, PLAN/06 §4): checklist with Perbaiki per problem and "Perbaiki semua (n)", the preview
 * dialog, "Cara manual" folded, undo + checked pm2 restart. Collapses to one line once pm2 is ready without warnings.
 * `adoptable` = unmanaged domains that can be adopted now; `onVerified` reloads the integration after any action.
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
  const [fixing, setFixing] = useState<FixKey[] | null>(null);
  const all = applicableFixes(integration);

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

  const dialog = fixing && (
    <Suspense fallback={null}>
      <FixDialog keys={fixing} onClose={() => setFixing(null)} onDone={onVerified} />
    </Suspense>
  );

  if (!setupNeeded(integration)) return <ReadyLine integration={integration} onVerified={onVerified} />;

  return (
    <section
      id={SETUP_ANCHOR}
      aria-labelledby="setup-title"
      className="flex scroll-mt-20 flex-col gap-4 rounded-lg border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="setup-title" className="text-base font-semibold">
            {t.title}
          </h2>
          <p className="mt-0.5 max-w-prose text-sm text-muted-foreground">{t.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {integration.checkedAt && (
            <span className="text-xs text-muted-foreground">
              <RelativeTime at={integration.checkedAt} format={t.checkedAt} />
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => void verify()} disabled={verifying}>
            <RefreshCwIcon className={verifying ? "motion-safe:animate-spin" : undefined} aria-hidden />
            {verifying ? t.checking : t.recheck}
          </Button>
          {all.length > 1 && (
            <Button size="sm" onClick={() => setFixing(all)}>
              <WrenchIcon aria-hidden />
              {t.fixAll(all.length)}
            </Button>
          )}
        </div>
      </div>
      <p aria-live="polite" className="text-sm font-medium empty:hidden">
        {result}
      </p>
      <SetupChecklist integration={integration} onFix={setFixing} onVerified={onVerified} />
      <SetupManual integration={integration} />
      <SetupActions integration={integration} onChange={onVerified} />
      {adoptable > 0 && (
        <div className="flex flex-col gap-1 border-t pt-3 text-sm">
          <h3 className="font-semibold">{t.adoptTitle}</h3>
          <p className="text-muted-foreground">{t.adoptBody(adoptable)}</p>
          <a href="#belum-dikelola" className="w-fit font-medium underline underline-offset-2">
            {t.adoptLink}
          </a>
        </div>
      )}
      {dialog}
    </section>
  );
}
