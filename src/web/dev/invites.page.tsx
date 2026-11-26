import { useState } from "react";
import { useSearchParams } from "react-router";
import type { DevInvite, Page } from "@/shared/dev.types";
import { Badge } from "@/web/components/ui/badge";
import { Card, CardContent } from "@/web/components/ui/card";
import { id } from "@/web/i18n/id";
import { ConfirmDelete } from "./confirm.dialog";
import { runDevAction } from "./dev.action";
import { devFetch, devUrl } from "./dev.api";
import { formatDateTime } from "./dev.format";
import { DEV_PAGE_SIZE, parsePageParam } from "./dev.pagination";
import { InviteForm } from "./invite.form";
import { Pager } from "./pager";
import { QueryView } from "./query.state";
import { useDevQuery } from "./use-dev-query";

const t = id.dev.invites;

function InviteRow({ inv, busy, onDelete }: { inv: DevInvite; busy: boolean; onDelete: () => void }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{inv.email}</span>
          <Badge variant={inv.registered ? "default" : "outline"}>{inv.registered ? t.registered : t.pending}</Badge>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {t.invitedBy(inv.invitedBy?.name ?? id.dev.common.system)} · {formatDateTime(inv.createdAt)}
        </p>
      </div>
      <ConfirmDelete
        label={`${id.dev.common.delete} ${inv.email}`}
        title={t.deleteTitle}
        disabled={busy}
        onConfirm={onDelete}
        description={
          <>
            <span>{t.deleteBody(inv.email)}</span>
            {inv.registered && <strong className="text-destructive">{t.deleteRegistered}</strong>}
          </>
        }
      />
    </li>
  );
}

/** /dev/invites: invite an email, list invites (paginated), revoke with confirmation. */
export function InvitesPage() {
  const [params] = useSearchParams();
  const page = parsePageParam(params.get("page"));
  const query = useDevQuery<Page<DevInvite>>(devUrl("/invites", { page, pageSize: DEV_PAGE_SIZE }));
  const [busy, setBusy] = useState<string | null>(null);

  const remove = async (email: string) => {
    setBusy(email);
    await runDevAction(() => devFetch<void>("DELETE", devUrl(`/invites/${encodeURIComponent(email)}`)), t.deleted);
    setBusy(null);
    query.reload();
  };

  return (
    <section className="flex flex-col gap-4">
      <Card className="py-4">
        <CardContent className="px-4">
          <InviteForm onAdded={query.reload} />
        </CardContent>
      </Card>
      <QueryView query={query} isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <ul className="divide-y">
              {d.items.map((inv) => (
                <InviteRow
                  key={inv.email}
                  inv={inv}
                  busy={busy === inv.email}
                  onDelete={() => void remove(inv.email)}
                />
              ))}
            </ul>
            <Pager page={d} />
          </>
        )}
      </QueryView>
    </section>
  );
}
