import { useState } from "react";
import { useSearchParams } from "react-router";
import type { AssignableRole, DevUser, DevUserPatch, Page } from "@/shared/dev.types";
import { id } from "@/web/i18n/id";
import { useMe } from "@/web/session/use-me";
import { QueryView } from "@/web/shared/query.state";
import { useApiQuery } from "@/web/shared/use-api-query";
import { devFetch, devUrl, runDevAction } from "./dev.api";
import { DEV_PAGE_SIZE, parsePageParam, withFilter } from "./dev.pagination";
import { Pager } from "./pager";
import { SearchBox } from "./search.box";
import { UsersList } from "./users.list";

const t = id.dev.users;

/** /dev/users: searchable, paginated user list with role change and delete. */
export function UsersPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const page = parsePageParam(params.get("page"));
  const query = useApiQuery<Page<DevUser>>(devUrl("/users", { page, pageSize: DEV_PAGE_SIZE, q }));
  const [busyId, setBusyId] = useState<string | null>(null);

  const mutate = async (userId: string, mutation: () => Promise<unknown>, success: string) => {
    setBusyId(userId);
    await runDevAction(mutation, success);
    setBusyId(null);
    query.reload(); // refresh on failure too: a 409 usually means the list is stale
  };

  const actions = {
    meId: me.id,
    busyId,
    onRole: (u: DevUser, role: AssignableRole) =>
      void mutate(
        u.id,
        () => devFetch<DevUser>("PATCH", devUrl(`/users/${encodeURIComponent(u.id)}`), { role } satisfies DevUserPatch),
        t.roleChanged,
      ),
    onDelete: (u: DevUser) =>
      void mutate(u.id, () => devFetch<void>("DELETE", devUrl(`/users/${encodeURIComponent(u.id)}`)), t.deleted),
  };

  return (
    <section className="flex flex-col gap-4">
      <SearchBox
        initial={q}
        placeholder={t.searchPlaceholder}
        label={t.searchPlaceholder}
        onSearch={(next) => setParams(withFilter(params, "q", next))}
      />
      <QueryView query={query} codes={id.dev.errorCodes} isEmpty={(d) => d.items.length === 0}>
        {(d) => (
          <>
            <UsersList items={d.items} actions={actions} />
            <Pager page={d} />
          </>
        )}
      </QueryView>
    </section>
  );
}
