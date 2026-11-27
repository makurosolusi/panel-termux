import { cn } from "cn";
import { CircleCheckIcon, InfoIcon, RefreshCwIcon, WrenchIcon } from "lucide-react";
import { lazy, type ReactNode, Suspense, useRef, useState } from "react";
import type { FixKey } from "@/shared/fix.types";
import type { Integration } from "@/shared/site.types";
import { RelativeTime } from "@/web/components/relative-time";
import { Button } from "@/web/components/ui/button";
import { tSite } from "@/web/i18n/en.site";
import { panelUrl } from "@/web/panel/panel.api";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch } from "@/web/shared/api.client";
import { toast } from "@/web/shared/toast.lazy";
import { SetupActions } from "./setup.actions";
import { SetupChecklist } from "./setup.checklist";
import { SetupManual } from "./setup.manual";
import { applicableFixes, checkText, pm2Pending, remainingProblems, setupNeeded } from "./site.adopt";
import { SITE_ERROR_CODES } from "./site.api";
import { LegacyAnchor } from "./site.legacy-anchor";

// preview dialog + diff only load when Fix is pressed (bundle budget, PLAN/06 §4.1)
const FixDialog = lazy(() => import("./fix.dialog").then((m) => ({ default: m.FixDialog })));

const t = tSite.setup;
/** Anchor of the card (onboarding links to /panel/sites#setup; the old #persiapan is a LegacyAnchor). */
const SETUP_ANCHOR = "setup";

/** One line once pm2 is ready, plus "Check again", the pending pm2 note and the undo/restart details. */
function ReadyLine({
  integration,
  verify,
  actions,
}: {
  integration: Integration;
  verify: ReactNode;
  actions: ReactNode;
}) {
  const pending = integration.checks?.find((c) => c.key === "pm2_auto_exit");
  return (
    <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex items-center gap-2">
          <CircleCheckIcon className="size-4 text-success" aria-hidden />
          {t.readyLine(integration.appNames?.length ?? 0)}
        </p>
        {verify}
      </div>
      {pending && pm2Pending(integration) && (
        <p className="flex items-center gap-2">
          <InfoIcon className="size-4 text-info" aria-hidden />
          {checkText(pending)}
        </p>
      )}
      {actions}
    </div>
  );
}

/**
 * Setup card (PLAN/03 §5.1, PLAN/06 §4): checklist with Fix per problem and "Fix all (n)", the preview
 * dialog, "Manual steps" folded, undo + checked pm2 restart. Collapses to one line once pm2 is ready without warnings.
 * `adoptable` = unmanaged domains that can be adopted now; `onVerified` reloads the integration after any action.
 * The <section> stays mounted in both shapes, so it is where focus lands once an action removed its own button.
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
  const [checked, setChecked] = useState<Integration | null>(null); // answer of the last "Check again"
  const [fixing, setFixing] = useState<FixKey[] | null>(null);
  const [restartWanted, setRestartWanted] = useState(false); // a fix applied here waits for a pm2 restart
  const card = useRef<HTMLElement>(null);
  const focusCard = () => card.current;
  const all = applicableFixes(integration);
  // the line follows the newest status, so a later fix or restart updates its count (QA fix-07 MAJOR-N1)
  const newest = checked && (checked.checkedAt ?? "") > (integration.checkedAt ?? "") ? checked : integration;
  const ready = !setupNeeded(integration); // folded: lists nothing, so never "Masih ada n"

  const verify = async () => {
    setVerifying(true);
    setChecked(null);
    try {
      setChecked(await apiFetch<Integration>("POST", panelUrl("/integration/verify")));
    } catch (err) {
      toast.error(apiErrorMessage(err, SITE_ERROR_CODES), { duration: ERROR_TOAST_MS });
    } finally {
      setVerifying(false);
      onVerified();
    }
  };
  const verifyButton = (
    <Button
      size="sm"
      variant={ready ? "ghost" : "outline"}
      onClick={() => void verify()}
      disabled={verifying}
      className={ready ? "h-auto px-1 py-0.5 pointer-coarse:py-3" : undefined}
    >
      <RefreshCwIcon className={verifying ? "motion-safe:animate-spin" : undefined} aria-hidden />
      {verifying ? t.checking : t.recheck}
    </Button>
  );
  const actions = (
    <SetupActions
      integration={integration}
      onChange={onVerified}
      focusCard={focusCard}
      restartWanted={restartWanted}
      onRestarted={() => setRestartWanted(false)}
    />
  );
  const resultLine = (
    <p aria-live="polite" className="text-sm font-medium empty:hidden">
      {checked ? (remainingProblems(newest) && !ready ? t.stillFailing(remainingProblems(newest)) : t.allOk) : ""}
    </p>
  );

  return (
    <section
      ref={card}
      id={SETUP_ANCHOR}
      tabIndex={-1}
      aria-labelledby={ready ? undefined : "setup-title"}
      aria-label={ready ? t.title : undefined}
      className={cn(
        "flex scroll-mt-20 flex-col outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        ready ? "gap-1.5 rounded-md" : "gap-4 rounded-lg border bg-card p-4",
      )}
    >
      <LegacyAnchor of="setup" scrollMargin="scroll-mt-20" />
      {ready ? (
        <>
          <ReadyLine integration={integration} verify={verifyButton} actions={actions} />
          {resultLine}
        </>
      ) : (
        <>
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
              {verifyButton}
              {all.length > 1 && (
                <Button size="sm" onClick={() => setFixing(all)}>
                  <WrenchIcon aria-hidden />
                  {t.fixAll(all.length)}
                </Button>
              )}
            </div>
          </div>
          {resultLine}
          <SetupChecklist
            integration={integration}
            onFix={setFixing}
            onVerified={() => {
              onVerified();
              card.current?.focus();
            }}
          />
          <SetupManual integration={integration} />
          {actions}
          {adoptable > 0 && (
            <div className="flex flex-col gap-1 border-t pt-3 text-sm">
              <h3 className="font-semibold">{t.adoptTitle}</h3>
              <p className="text-muted-foreground">{t.adoptBody(adoptable)}</p>
              <a href="#not-managed" className="w-fit font-medium underline underline-offset-2 pointer-coarse:py-3">
                {t.adoptLink}
              </a>
            </div>
          )}
        </>
      )}
      {fixing && (
        <Suspense fallback={null}>
          <FixDialog
            keys={fixing}
            onClose={() => setFixing(null)}
            onDone={(r) => {
              if (r) setRestartWanted(true);
              onVerified();
            }}
            focusAfter={focusCard}
          />
        </Suspense>
      )}
    </section>
  );
}
