import { WrenchIcon } from "lucide-react";
import { Link } from "react-router";
import type { FixKey } from "@/shared/fix.types";
import { hasRole } from "@/shared/roles";
import type { Integration, IntegrationCheck } from "@/shared/site.types";
import { CodeText } from "@/web/components/code-text";
import type { StatusKey } from "@/web/components/status.vocab";
import { StatusIcon } from "@/web/components/status-icon";
import { Button } from "@/web/components/ui/button";
import { idSite } from "@/web/i18n/id.site";
import { useMe } from "@/web/session/use-me";
import { ServiceStartButton } from "@/web/shared/service-start";
import { checkText, rowBlocked, rowFix, visibleChecks } from "./site.adopt";

const t = idSite.setup;
const CHECK_STATE: Record<IntegrationCheck["state"], StatusKey> = { ok: "done", warning: "attention", error: "failed" };

/** Action of a failing row: Perbaiki, Jalankan pm2, or the plain reason the panel cannot fix it. */
function RowAction({
  integration,
  check,
  onFix,
  onVerified,
}: {
  integration: Integration;
  check: IntegrationCheck;
  onFix: (keys: FixKey[]) => void;
  onVerified: () => void;
}) {
  const fix = rowFix(integration, check);
  const blocked = rowBlocked(integration, check);
  if (check.key === "pm2_runtime" && check.state === "error")
    return <ServiceStartButton service="pm2" onStarted={onVerified} />;
  if (fix)
    return (
      <Button size="sm" variant="outline" onClick={() => onFix([fix])} aria-label={t.fixLabel(checkText(check))}>
        <WrenchIcon aria-hidden />
        {t.fix}
      </Button>
    );
  if (!blocked) return null;
  return (
    <span className="text-xs text-muted-foreground">
      <CodeText>{`${t.unfixable[blocked]} ${t.unfixableSuffix}`}</CodeText>
    </span>
  );
}

/** Persiapan checklist: one row per problem, each failing row with its action (PLAN/06 §4.1). */
export function SetupChecklist({
  integration,
  onFix,
  onVerified,
}: {
  integration: Integration;
  onFix: (keys: FixKey[]) => void;
  onVerified: () => void;
}) {
  const me = useMe();
  return (
    <ul aria-label={t.checklist} className="flex flex-col gap-2.5 text-sm">
      {visibleChecks(integration).map((c) => (
        <li key={c.key} className="flex items-start gap-2">
          <StatusIcon state={CHECK_STATE[c.state]} className="mt-0.5" />
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
            <span className={c.state === "ok" ? "text-muted-foreground" : undefined}>
              <CodeText>{checkText(c)}</CodeText>
              {c.key === "cloudflare_token" && c.state !== "ok" && hasRole(me.role, "super_admin") && (
                <>
                  {" "}
                  <Link to="/dev/settings" className="font-medium underline underline-offset-2">
                    {t.tokenLink}
                  </Link>
                </>
              )}
            </span>
            {c.state !== "ok" && c.detail && (
              // e.g. pm2's own load error of a broken ecosystem (QA fix-04 MINOR-9)
              <code className="max-w-full font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">
                {c.detail}
              </code>
            )}
            {c.state !== "ok" && (
              <RowAction integration={integration} check={c} onFix={onFix} onVerified={onVerified} />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
