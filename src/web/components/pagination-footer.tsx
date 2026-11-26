import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/web/components/ui/button";
import { idShell } from "@/web/i18n/id.shell";
import { formatNumber } from "@/web/shared/format";

const t = idShell.table;

/** 1-based page state for the footer; `total` = number of entries across all pages. */
export type DataPagination = { page: number; pageCount: number; total?: number; onPageChange: (page: number) => void };

/** Prev/next footer with "Halaman x dari y"; hidden when everything fits on one page. Also used by non-table lists. */
export function PaginationFooter({ p }: { p: DataPagination }) {
  if (p.pageCount <= 1) return null;
  const text =
    p.total === undefined ? t.page(p.page, p.pageCount) : t.pageWithTotal(p.page, p.pageCount, formatNumber(p.total));
  return (
    <nav aria-label={t.pagination} className="flex items-center justify-between gap-2 text-sm">
      <Button
        variant="outline"
        size="sm"
        className="pointer-coarse:min-w-11"
        disabled={p.page <= 1}
        onClick={() => p.onPageChange(p.page - 1)}
      >
        <ChevronLeftIcon aria-hidden />
        <span className="sr-only sm:not-sr-only">{t.prev}</span>
      </Button>
      <span className="text-center text-muted-foreground tabular-nums" aria-live="polite">
        {text}
      </span>
      <Button
        variant="outline"
        size="sm"
        className="pointer-coarse:min-w-11"
        disabled={p.page >= p.pageCount}
        onClick={() => p.onPageChange(p.page + 1)}
      >
        <span className="sr-only sm:not-sr-only">{t.next}</span>
        <ChevronRightIcon aria-hidden />
      </Button>
    </nav>
  );
}
