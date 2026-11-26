import type { ReactNode } from "react";
import { EmptyState } from "@/web/components/empty-state";
import { QueryView as SharedQueryView } from "@/web/components/query-view";
import { id } from "@/web/i18n/id";
import type { ErrorCodes } from "./api.client";
import type { ApiQuery } from "./use-api-query";

/**
 * Compatibility wrapper over `components/query-view.tsx` for pages not migrated yet (W5/W6): no required `empty`
 * (generic copy) and, as before, nothing counts as empty unless `isEmpty` says so. Deleted by the shell cleanup.
 */
export function QueryView<T>({
  query,
  isEmpty = () => false,
  codes,
  skeleton,
  children,
}: {
  query: ApiQuery<T>;
  isEmpty?: (data: T) => boolean;
  codes?: ErrorCodes;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  return (
    <SharedQueryView
      query={query}
      empty={<EmptyState title={id.common.empty} />}
      isEmpty={isEmpty}
      codes={codes}
      skeleton={skeleton}
    >
      {children}
    </SharedQueryView>
  );
}
