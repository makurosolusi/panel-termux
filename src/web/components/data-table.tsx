import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/web/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";
import { id } from "@/web/i18n/id";
import { RowsSkeleton } from "./skeletons";

const t = id.shell.table;

/** One column. `primary` = card title on phones; `hideOnMobile` drops it from the card; `align` for numbers. */
export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
  primary?: boolean;
  hideOnMobile?: boolean;
};

/** 1-based page state for the optional footer. */
export type DataPagination = { page: number; pageCount: number; onPageChange: (page: number) => void };

/**
 * List pattern: bordered table with sticky header and row hover from `md`, stacked cards on phones. Exactly one
 * of loading / error / empty / rows is shown; `toolbar` sits above (search, filters), `pagination` below.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  loading = false,
  error,
  empty,
  toolbar,
  pagination,
  className,
}: {
  columns: readonly DataColumn<T>[];
  rows: readonly T[] | undefined;
  rowKey: (row: T) => string;
  label: string;
  loading?: boolean;
  error?: ReactNode;
  empty?: ReactNode;
  toolbar?: ReactNode;
  pagination?: DataPagination;
  className?: string;
}) {
  const body = error ? (
    error
  ) : loading && !rows ? (
    <RowsSkeleton />
  ) : !rows || rows.length === 0 ? (
    empty
  ) : (
    <>
      <div className="hidden max-h-[min(70vh,48rem)] overflow-auto rounded-lg border bg-card md:block">
        <table aria-label={label} className="w-full caption-bottom text-sm">
          <TableHeader className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn(
                    "h-9 px-3 text-xs text-muted-foreground",
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                >
                  {c.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn("px-3 py-2.5", c.align === "right" && "text-right tabular-nums", c.className)}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
      <ul aria-label={label} className="flex flex-col gap-2 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="rounded-lg border bg-card p-3 text-sm">
            <MobileCard columns={columns} row={row} />
          </li>
        ))}
      </ul>
    </>
  );
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy={loading || undefined}>
      {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      {body}
      {pagination && pagination.pageCount > 1 && <PaginationFooter p={pagination} />}
    </div>
  );
}

function MobileCard<T>({ columns, row }: { columns: readonly DataColumn<T>[]; row: T }) {
  const primary = columns.find((c) => c.primary);
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);
  return (
    <>
      {primary && <div className="mb-2 font-medium">{primary.cell(row)}</div>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rest.map((c) => (
          <div key={c.key} className="contents">
            <dt className="text-xs text-muted-foreground">{c.header}</dt>
            <dd className="min-w-0 text-right tabular-nums">{c.cell(row)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function PaginationFooter({ p }: { p: DataPagination }) {
  return (
    <nav aria-label={t.page(p.page, p.pageCount)} className="flex items-center justify-between gap-2 text-sm">
      <Button variant="outline" size="sm" disabled={p.page <= 1} onClick={() => p.onPageChange(p.page - 1)}>
        <ChevronLeftIcon aria-hidden />
        <span className="sr-only sm:not-sr-only">{t.prev}</span>
      </Button>
      <span className="text-muted-foreground tabular-nums">{t.page(p.page, p.pageCount)}</span>
      <Button variant="outline" size="sm" disabled={p.page >= p.pageCount} onClick={() => p.onPageChange(p.page + 1)}>
        <span className="sr-only sm:not-sr-only">{t.next}</span>
        <ChevronRightIcon aria-hidden />
      </Button>
    </nav>
  );
}
