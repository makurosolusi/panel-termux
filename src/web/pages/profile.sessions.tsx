import { LogOutIcon, MonitorSmartphoneIcon } from "lucide-react";
import { toast } from "sonner";
import type { MeRevokeOthers, MeSession } from "@/shared/me.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { type DataColumn, DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { QueryView } from "@/web/components/query-view";
import { Section } from "@/web/components/section";
import { RowsSkeleton } from "@/web/components/skeletons";
import { StatusBadge } from "@/web/components/status-badge";
import { Button } from "@/web/components/ui/button";
import { idAccount } from "@/web/i18n/id.account";
import { ApiError, apiFetch } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";

const t = idAccount.sessions;
const SESSIONS_URL = "/api/me/sessions";
/** Server fallback of `shortUserAgent` when neither browser nor OS is recognised. */
const SERVER_UNKNOWN_DEVICE = "Unknown device";

/** Indonesian device line from the server's "Browser on OS" string; unknown/missing → "Perangkat tidak dikenal". */
export function sessionDevice(userAgent: string | null): string {
  if (!userAgent || userAgent === SERVER_UNKNOWN_DEVICE) return t.unknownDevice;
  const [browser, os] = userAgent.split(" on ");
  return browser && os ? t.deviceOn(browser, os) : userAgent;
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Last activity at day resolution (local calendar): "Aktif hari ini" / "Aktif kemarin" / "Aktif 20 Nov 2026". */
export function sessionActiveLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return t.activeOn("–");
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (days <= 0) return t.activeToday;
  if (days === 1) return t.activeYesterday;
  return t.activeOn(at.toLocaleDateString("id-ID", { dateStyle: "medium" }));
}

/** "Keluar dari semua perangkat lain" is offered only when another session exists. */
export const hasOtherSessions = (rows: readonly MeSession[]): boolean => rows.some((r) => !r.current);

const COLUMNS: readonly DataColumn<MeSession>[] = [
  { key: "device", header: t.device, mobile: "title", cell: (r) => sessionDevice(r.userAgent) },
  {
    key: "current",
    header: <span className="sr-only">{t.current}</span>,
    mobile: "badge",
    cell: (r) => (r.current ? <StatusBadge tone="info" label={t.current} /> : null),
  },
  { key: "ip", header: t.ip, cell: (r) => <span className="font-mono">{r.ipMasked ?? t.ipHidden}</span> },
  { key: "active", header: t.lastActive, cell: (r) => sessionActiveLabel(r.lastActiveAt) },
];

/** "Sesi aktif" card: own sessions with per-device revoke and "sign out everywhere else" (PLAN/05 F8 step 2). */
export function ProfileSessions() {
  const query = useApiQuery<MeSession[]>(SESSIONS_URL);

  const revoke = async (row: MeSession) => {
    let message: string = t.revoked;
    try {
      await apiFetch<void>("DELETE", `${SESSIONS_URL}/${encodeURIComponent(row.id)}`);
    } catch (err) {
      // already expired or ended elsewhere: the list is stale, not the action
      if (!(err instanceof ApiError && err.status === 404)) throw err;
      message = t.gone;
    }
    query.reload();
    toast.success(message);
  };
  const revokeOthers = async () => {
    const res = await apiFetch<MeRevokeOthers>("POST", `${SESSIONS_URL}/revoke-others`);
    query.reload();
    toast.success(t.revokedOthers(res.revoked));
  };

  const others = query.data && hasOtherSessions(query.data);
  return (
    <Section
      title={t.title}
      description={t.description}
      action={
        others && (
          <ConfirmAction
            title={t.revokeOthersTitle}
            description={t.revokeOthersBody}
            confirmLabel={t.revokeOthers}
            destructive
            onConfirm={revokeOthers}
            trigger={
              <Button variant="outline" size="sm">
                <LogOutIcon aria-hidden />
                {t.revokeOthers}
              </Button>
            }
          />
        )
      }
    >
      <QueryView
        query={query}
        skeleton={<RowsSkeleton rows={2} />}
        empty={<EmptyState icon={MonitorSmartphoneIcon} title={t.empty} />}
      >
        {(rows) => (
          <DataTable
            label={t.title}
            columns={COLUMNS}
            rows={rows}
            rowKey={(r) => r.id}
            rowTone={(r) => (r.current ? "info" : undefined)}
            actions={(r) =>
              r.current ? (
                <span className="text-xs text-muted-foreground">{t.currentHint}</span>
              ) : (
                <ConfirmAction
                  title={t.revokeTitle(sessionDevice(r.userAgent))}
                  description={t.revokeBody}
                  confirmLabel={t.revoke}
                  destructive
                  onConfirm={() => revoke(r)}
                  trigger={
                    <Button variant="ghost" size="sm" className="text-danger">
                      {t.revoke}
                    </Button>
                  }
                />
              )
            }
          />
        )}
      </QueryView>
    </Section>
  );
}
