import { cn } from "cn";
import { InfoIcon, LogInIcon, type LucideIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TONE_CLASS, TONE_TEXT } from "@/web/components/status.tone";
import { Button } from "@/web/components/ui/button";
import { idSecurity } from "@/web/i18n/id.security";
import { reauthenticate } from "./security.api";

/** Tones a notice can have. */
export type NoticeTone = "info" | "warning" | "danger";

const ICON: Record<NoticeTone, LucideIcon> = { info: InfoIcon, warning: TriangleAlertIcon, danger: OctagonXIcon };

/** Inline banner: tone icon, message, optional actions. `alert` makes it a live region for errors that appear later. */
export function Notice({
  tone,
  children,
  actions,
  alert = false,
  className,
}: {
  tone: NoticeTone;
  children: ReactNode;
  actions?: ReactNode;
  alert?: boolean;
  className?: string;
}) {
  const Icon = ICON[tone];
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm text-foreground sm:flex-row sm:items-start",
        TONE_CLASS[tone],
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[tone])} aria-hidden />
        <div className="flex min-w-0 flex-col gap-1.5 text-foreground">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2 max-sm:pl-6">{actions}</div>}
    </div>
  );
}

/** "Sign in again" notice shown after a 403 `reauth_required`; the button starts Google sign-in back to this page. */
export function ReauthNotice({ message = idSecurity.reauth.body }: { message?: string }) {
  const t = idSecurity.reauth;
  return (
    <Notice
      tone="warning"
      alert
      actions={
        <Button size="sm" onClick={() => void reauthenticate()}>
          <LogInIcon aria-hidden />
          {t.button}
        </Button>
      }
    >
      <p>{message}</p>
      <p className="text-xs text-muted-foreground">{t.freshNote}</p>
    </Notice>
  );
}
