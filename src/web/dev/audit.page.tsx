import { useSearchParams } from "react-router";
import type { DevAuditEntry, Page } from "@/shared/dev.types";
import { Badge } from "@/web/components/ui/badge";
import { id } from "@/web/i18n/id";
import { formatDateTime } from "@/web/shared/format";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { devUrl } from "./dev.api";
import { DEV_PAGE_SIZE, parsePageParam, withFilter } from "./dev.pagination";
import { Pager } from "./pager";
import { SearchBox } from "./search.box";

const t = id.dev.audit;

/** Actions the server records today; offered as suggestions only, any value can be typed. */
const KNOWN_ACTIONS = ["auth.sign_in", "user.role_change", "user.delete", "settings.update"] as const;

function AuditRow({ e }: { e: DevAuditEntry }) {
  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono">
          {e.action}
        </Badge>
        {e.target && <span className="truncate font-medium">{e.target}</span>}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatDateTime(e.at)} · {e.actor?.name ?? id.dev.common.system}
      </p>
      {e.meta && (
        <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-xs whitespace-pre">
          {JSON.stringify(e.meta)}
        </code>
      )}
    </li>
  );
}

/** /dev/audit: paginated audit trail, newest first, filterable by action. */
export function AuditPage() {
  const [params, setParams] = useSearchParams();
  const action = params.get("action") ?? "";
  const page = parsePageParam(params.get("page"));
  const query = useApiQuery<Page<DevAuditEntry>>(devUrl("/audit", { page, pageSize: DEV_PAGE_SIZE, action }));
  return (
    <section className="flex flex-col gap-4">
      <SearchBox
        initial={action}
        label={t.actionFilter}
        placeholder={t.actionPlaceholder}
        list="audit-actions"
        onSearch={(next) => setParams(withFilter(params, "action", next))}
      />
      <datalist id="audit-actions">
        {KNOWN_ACTIONS.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <QueryView query={query} codes={id.dev.errorCodes} isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <ul className="divide-y">
              {d.items.map((e) => (
                <AuditRow key={e.id} e={e} />
              ))}
            </ul>
            <Pager page={d} />
          </>
        )}
      </QueryView>
    </section>
  );
}
