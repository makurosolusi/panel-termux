import { DownloadIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { SecurityStatus } from "@/shared/security.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { InlineCode } from "@/web/components/inline-code";
import { KeyValue } from "@/web/components/key-value";
import { RelativeTime } from "@/web/components/relative-time";
import { Section } from "@/web/components/section";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { DATA_KEY_ANCHOR, devAnchorFromHash } from "@/web/dev/onboarding.state";
import { tSecurity } from "@/web/i18n/en.security";
import { tSettings } from "@/web/i18n/en.settings";
import { toast } from "@/web/shared/toast.lazy";
import { exportDataKey, isReauthRequired, resetDataKey, SECURITY_ERROR_CODES } from "./security.api";
import { Notice, ReauthNotice } from "./security.notice";
import { dataKeyStatusKey } from "./security.state";

const t = tSecurity.dataKey;

/** Field label of a setting key from the settings copy, or the raw key when it has none. */
export const settingLabel = (key: string): string =>
  (tSettings.fields as Record<string, { label: string } | undefined>)[key]?.label ?? key;

/**
 * "Data key" card (`#data-key`, old `#kunci-data` aliased, PLAN/04 §5.2): match state, last download, "Download the data key" (confirm, fresh
 * session); on mismatch the unreadable settings, restore-the-file steps and the typed reset. `onChanged` reloads the
 * security status after a download or reset.
 */
export function DataKeyCard({ status, onChanged }: { status: SecurityStatus; onChanged: () => void }) {
  const key = status.dataKey;
  const [reauth, setReauth] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { hash } = useLocation();
  // rendered after the security fetch, so the browser's own hash jump (and any 0.5.x `#kunci-data` link) missed it
  useEffect(() => {
    if (devAnchorFromHash(hash) === DATA_KEY_ANCHOR) ref.current?.scrollIntoView({ block: "start" });
  }, [hash]);
  const mismatch = key.state === "mismatch";
  const labels = key.unreadableSettings.map(settingLabel);

  // A stale session is not an error of the dialog: close it and show "Sign in again" in the card instead.
  const sensitive = async (action: () => Promise<unknown>, done: string) => {
    try {
      await action();
    } catch (err) {
      if (!isReauthRequired(err)) throw err;
      setReauth(true);
      return;
    }
    setReauth(false);
    toast.success(done);
    onChanged();
  };

  return (
    <div ref={ref} id={DATA_KEY_ANCHOR} className="scroll-mt-20 rounded-lg border bg-card p-4">
      <Section
        title={t.title}
        description={t.help}
        action={
          !mismatch && (
            <ConfirmAction
              title={t.exportTitle}
              description={t.exportBody}
              confirmLabel={t.exportButton}
              codes={SECURITY_ERROR_CODES}
              onConfirm={() => sensitive(exportDataKey, t.exported)}
              trigger={
                <Button variant="outline" size="sm">
                  <DownloadIcon aria-hidden />
                  {t.exportButton}
                </Button>
              }
            />
          )
        }
      >
        <KeyValue
          items={[
            {
              label: t.state,
              value: <StatusBadge state={dataKeyStatusKey(key.state)} label={mismatch ? t.mismatch : t.ok} />,
            },
            {
              label: t.exportedAt,
              value: key.exportedAt ? <RelativeTime at={key.exportedAt} /> : t.never,
            },
          ]}
        />
        {reauth && <ReauthNotice />}
        {mismatch && (
          <Notice tone="danger">
            <p>{t.mismatchBody}</p>
            <ul className="flex flex-wrap gap-1.5">
              {labels.map((l) => (
                <li key={l} className="rounded-md border bg-background px-2 py-0.5 text-xs">
                  {l}
                </li>
              ))}
            </ul>
            <p>{t.noTelegram}</p>
            {key.createdThisBoot && <p className="text-muted-foreground">{t.createdThisBoot}</p>}
            <p className="font-medium">{t.restoreFile}</p>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium pointer-coarse:py-3">{t.restoreStepsLabel}</summary>
              <ol className="mt-2 flex flex-col gap-1">
                {t.restoreSteps.map((cmd) => (
                  <li key={cmd}>
                    <InlineCode copy>{cmd}</InlineCode>
                  </li>
                ))}
              </ol>
            </details>
            <p className="text-muted-foreground">{t.orReset}</p>
            <ConfirmAction
              tier="typed"
              typedValue={t.resetWord}
              destructive
              title={t.resetTitle}
              description={t.resetBody(labels)}
              confirmLabel={t.resetButton}
              codes={SECURITY_ERROR_CODES}
              onConfirm={(typed) => sensitive(() => resetDataKey(typed ?? ""), t.resetDone)}
              trigger={
                <Button variant="destructive" size="sm" className="self-start">
                  <Trash2Icon aria-hidden />
                  {t.resetButton}
                </Button>
              }
            />
          </Notice>
        )}
      </Section>
    </div>
  );
}
