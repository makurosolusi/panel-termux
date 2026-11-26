import { LogOutIcon, UsersIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import type { DevUser, Page } from "@/shared/dev.types";
import { isRole, ROLES } from "@/shared/roles";
import { ConfirmAction } from "@/web/components/confirm-action";
import { DataTable } from "@/web/components/data-table";
import { EmptyState } from "@/web/components/empty-state";
import { useNow } from "@/web/components/now.store";
import { PageHeader } from "@/web/components/page-header";
import { QueryView } from "@/web/components/query-view";
import { SearchField } from "@/web/components/search-field";
import { Button } from "@/web/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { usePageParam } from "@/web/components/use-page-param";
import { idApp } from "@/web/i18n/id.app";
import { idDevUsers } from "@/web/i18n/id.dev.users";
import { revokeAllSessions } from "@/web/security/security.api";
import { useMe } from "@/web/session/use-me";
import { apiUrl } from "@/web/shared/api.client";
import { useApiQuery } from "@/web/shared/use-api-query";
import { UserRowActions, userColumns } from "./users.list";

const t = idDevUsers;
const PAGE_SIZE = 20;
const ALL = "all";
/** Typing pause before the search reaches the URL (and the API). */
const SEARCH_DEBOUNCE_MS = 300;

/** /dev/users?q&role&page: who can sign in, their role, activity and sessions; role change, sign-out, delete. */
export function UsersPage() {
  const me = useMe();
  const now = useNow();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = usePageParam();
  const q = params.get("q") ?? "";
  const roleParam = params.get("role");
  const role = isRole(roleParam) ? roleParam : null;
  const filtered = Boolean(q || role);
  const query = useApiQuery<Page<DevUser>>(apiUrl("/api/dev", "/users", { page, pageSize: PAGE_SIZE, q, role }));

  const setFilter = (key: string, value: string | null) =>
    setParams((prev) => {
      const out = new URLSearchParams(prev);
      out.delete("page");
      if (value) out.set(key, value);
      else out.delete(key);
      return out;
    });

  const [search, setSearch] = useState(q);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the typed text schedules a URL update
  useEffect(() => {
    if (search.trim() === q) return;
    const timer = setTimeout(() => setFilter("q", search.trim() || null), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const toolbar = (
    <>
      <SearchField value={search} onChange={setSearch} label={t.search} placeholder={t.searchPlaceholder} />
      <Select value={role ?? ALL} onValueChange={(v) => setFilter("role", v === ALL ? null : v)}>
        <SelectTrigger size="sm" className="w-40" aria-label={t.roleFilter}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t.allRoles}</SelectItem>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {idApp.roles[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            setParams(new URLSearchParams());
          }}
        >
          <XIcon aria-hidden />
          {t.clearFilters}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        title={t.title}
        description={t.description}
        meta={{ updatedAt: query.updatedAt, onRefresh: query.reload, refreshing: query.loading }}
        actions={
          <ConfirmAction
            tier="typed"
            typedValue={t.revokeAllWord}
            destructive
            title={t.revokeAllTitle}
            description={t.revokeAllBody}
            confirmLabel={t.revokeAll}
            codes={t.errorCodes}
            onConfirm={async () => {
              const { revoked } = await revokeAllSessions();
              toast.success(t.revokedAll(revoked));
              query.reload();
            }}
            trigger={
              <Button variant="outline" size="sm">
                <LogOutIcon aria-hidden />
                {t.revokeAll}
              </Button>
            }
          />
        }
      />
      <QueryView
        query={query}
        codes={t.errorCodes}
        isEmpty={(d) => d.items.length === 0 && !filtered}
        empty={<EmptyState icon={UsersIcon} title={t.empty} />}
      >
        {(d) => (
          <DataTable
            label={t.label}
            columns={userColumns(me.id, now)}
            rows={d.items}
            rowKey={(u) => u.id}
            actions={(u) => <UserRowActions u={u} meId={me.id} onChanged={query.reload} />}
            toolbar={toolbar}
            empty={<EmptyState title={t.emptyFiltered} />}
            pagination={{
              page: d.page,
              pageCount: Math.max(1, Math.ceil(d.total / d.pageSize)),
              total: d.total,
              onPageChange: setPage,
            }}
          />
        )}
      </QueryView>
    </div>
  );
}
