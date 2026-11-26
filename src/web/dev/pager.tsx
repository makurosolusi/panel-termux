import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useSearchParams } from "react-router";
import type { Page } from "@/shared/dev.types";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";
import { pageCount, withPage } from "./dev.pagination";

/** Prev/next controls bound to `?page=`; hidden when everything fits on one page. */
export function Pager({ page }: { page: Page<unknown> }) {
  const [params, setParams] = useSearchParams();
  const pages = pageCount(page.total, page.pageSize);
  if (pages <= 1) return null;
  const go = (p: number) => setParams(withPage(params, p));
  return (
    <nav className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
      <Button variant="outline" size="sm" disabled={page.page <= 1} onClick={() => go(page.page - 1)}>
        <ChevronLeftIcon aria-hidden />
        <span className="sr-only sm:not-sr-only">{id.dev.common.prev}</span>
      </Button>
      <span>{id.dev.common.pageOf(page.page, pages, page.total)}</span>
      <Button variant="outline" size="sm" disabled={page.page >= pages} onClick={() => go(page.page + 1)}>
        <span className="sr-only sm:not-sr-only">{id.dev.common.next}</span>
        <ChevronRightIcon aria-hidden />
      </Button>
    </nav>
  );
}
