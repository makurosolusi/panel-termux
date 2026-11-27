import type { SecurityStatus } from "@/shared/security.types";
import { RelativeTime } from "@/web/components/relative-time";
import { StatusBadge } from "@/web/components/status-badge";
import { tSecurity } from "@/web/i18n/en.security";
import { accessState } from "./security.state";

const t = tSecurity.access;

/** "Cloudflare Access" row (`#access`): not applicable on http, seen (with time), or a warning to set it up. */
export function AccessStatusRow({ access }: { access: SecurityStatus["access"] }) {
  const state = accessState(access);
  return (
    <div id="access" className="flex scroll-mt-20 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-medium">{t.title}</span>
      {state === "not_https" && <span className="text-muted-foreground">{t.notHttps}</span>}
      {state === "seen" && access.lastSeenAt && (
        <>
          <StatusBadge state="succeeded" label={t.seen} />
          <RelativeTime at={access.lastSeenAt} className="text-muted-foreground" />
        </>
      )}
      {state === "not_seen" && (
        <>
          <StatusBadge state="attention" />
          <span className="min-w-0 basis-full text-muted-foreground sm:basis-auto">{t.notSeen}</span>
        </>
      )}
    </div>
  );
}
