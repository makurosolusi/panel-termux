import { LogOutIcon } from "lucide-react";
import type { SecurityStatus } from "@/shared/security.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { Section } from "@/web/components/section";
import { Button } from "@/web/components/ui/button";
import { tSecurity } from "@/web/i18n/en.security";
import { toast } from "@/web/shared/toast.lazy";
import { revokeAllSessions, SECURITY_ERROR_CODES } from "./security.api";

const t = tSecurity.sessions;

/** "Sesi" card: active sessions summary and "Keluarkan semua pengguna" (tier confirm; this device stays signed in). */
export function SessionsAdminCard({ status, onChanged }: { status: SecurityStatus; onChanged: () => void }) {
  return (
    <div id="sesi" className="scroll-mt-20 rounded-lg border bg-card p-4">
      <Section
        title={t.title}
        action={
          <ConfirmAction
            destructive
            title={t.revokeAllTitle}
            description={t.revokeAllBody}
            confirmLabel={t.revokeAll}
            codes={SECURITY_ERROR_CODES}
            onConfirm={async () => {
              const { revoked } = await revokeAllSessions();
              toast.success(t.revokedAll(revoked));
              onChanged();
            }}
            trigger={
              <Button variant="outline" size="sm">
                <LogOutIcon aria-hidden />
                {t.revokeAll}
              </Button>
            }
          />
        }
      >
        <p className="text-sm text-muted-foreground">{t.summary(status.sessions.active, status.sessions.users)}</p>
      </Section>
    </div>
  );
}
