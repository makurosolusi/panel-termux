import { cn } from "cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { Button } from "@/web/components/ui/button";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";
import { id } from "@/web/i18n/id";
import { formatNumber } from "@/web/shared/format";
import type { StatusTone } from "./status.tone";

const t = id.shell.table;

/** One column. `mobile` = its slot in the phone card (default "meta"); `align` for numbers. */
export type DataColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
  className?: string;
  /** Phone card slot; default "meta". */
  mobile?: "title" | "badge" | "meta" | "hidden";
};

/** 1-based page state for the footer; `total` = number of entries across all pages. */
export type DataPagination = { page: number; pageCount: number; total?: number; onPageChange: (page: number) => void };

/** 2 px left edge per row tone (tokens only). */
const TONE_EDGE: Record<StatusTone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
  neutral: "border-l-muted-foreground",
  accent: "border-l-brand",
};

/** Stretches a link over its positioned ancestor, so the whole row/card is clickable. */
const STRETCH =
  "outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-lg focus-visible:after:ring-[3px] focus-visible:after:ring-ring/50";

/**
 * List pattern: bordered table from `md`, cards on phones (title + badge / meta line / actions footer, PLAN/01
 * §5.2b). Loading and errors belong to QueryView; `empty` shows when `rows` is empty (e.g. a filter matched nothing).
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  rowHref,
  actions,
  rowTone,
  empty,
  toolbar,
  pagination,
  className,
}: {
  columns: readonly DataColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  label: string;
  rowHref?: (row: T) => string;
  actions?: (row: T) => ReactNode;
  rowTone?: (row: T) => StatusTone | undefined;
  empty?: ReactNode;
  toolbar?: ReactNode;
  pagination?: DataPagination;
  className?: string;
}) {
  const titleCol = columns.find((c) => c.mobile === "title") ?? columns[0];
  const titleCell = (row: T) => {
    const content = titleCol?.cell(row);
    return rowHref ? (
      <Link to={rowHref(row)} className={STRETCH}>
        {content}
      </Link>
    ) : (
      content
    );
  };
  const edge = (row: T) => {
    const tone = rowTone?.(row);
    return tone && cn("border-l-2", TONE_EDGE[tone]);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      {rows.length === 0 ? (
        empty
      ) : (
        <>
          <div className="hidden max-h-[min(70vh,48rem)] overflow-auto rounded-lg border bg-card md:block">
            <table aria-label={label} className="w-full caption-bottom text-sm">
              <TableHeader className="sticky top-0 z-20 bg-muted/80 backdrop-blur">
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
                  {actions && (
                    <TableHead className="h-9 px-3">
                      <span className="sr-only">{t.actions}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={rowKey(row)} className={cn(rowHref && "relative", edge(row))}>
                    {columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn("px-3 py-2.5", c.align === "right" && "text-right tabular-nums", c.className)}
                      >
                        {c === titleCol ? titleCell(row) : c.cell(row)}
                      </TableCell>
                    ))}
                    {actions && (
                      <TableCell className="relative z-10 px-3 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">{actions(row)}</div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
          <ul aria-label={label} className="flex flex-col gap-2 md:hidden">
            {rows.map((row) => (
              <li
                key={rowKey(row)}
                className={cn("relative flex min-h-14 flex-col gap-1 rounded-lg border bg-card p-3 text-sm", edge(row))}
              >
                <MobileCard columns={columns} titleCol={titleCol} title={titleCell(row)} row={row} />
                {actions && (
                  <div className="relative z-10 mt-1 flex items-center justify-between gap-2 border-t pt-2">
                    {actions(row)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {pagination && pagination.pageCount > 1 && <PaginationFooter p={pagination} />}
    </div>
  );
}

function MobileCard<T>({
  columns,
  titleCol,
  title,
  row,
}: {
  columns: readonly DataColumn<T>[];
  titleCol: DataColumn<T> | undefined;
  title: ReactNode;
  row: T;
}) {
  const badges = columns.filter((c) => c !== titleCol && c.mobile === "badge");
  const meta = columns.filter((c) => c !== titleCol && (c.mobile ?? "meta") === "meta");
  return (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 truncate font-medium">{title}</div>
        {badges.length > 0 && (
          <div className="flex shrink-0 items-center gap-1">
            {badges.map((c) => (
              <Fragment key={c.key}>{c.cell(row)}</Fragment>
            ))}
          </div>
        )}
      </div>
      {meta.length > 0 && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {meta.map((c, i) => (
            <Fragment key={c.key}>
              {i > 0 && " · "}
              {c.cell(row)}
            </Fragment>
          ))}
        </p>
      )}
    </>
  );
}

function PaginationFooter({ p }: { p: DataPagination }) {
  const text =
    p.total === undefined ? t.page(p.page, p.pageCount) : t.pageWithTotal(p.page, p.pageCount, formatNumber(p.total));
  return (
    <nav aria-label={t.pagination} className="flex items-center justify-between gap-2 text-sm">
      <Button variant="outline" size="sm" disabled={p.page <= 1} onClick={() => p.onPageChange(p.page - 1)}>
        <ChevronLeftIcon aria-hidden />
        <span className="sr-only sm:not-sr-only">{t.prev}</span>
      </Button>
      <span className="text-center text-muted-foreground tabular-nums" aria-live="polite">
        {text}
      </span>
      <Button variant="outline" size="sm" disabled={p.page >= p.pageCount} onClick={() => p.onPageChange(p.page + 1)}>
        <span className="sr-only sm:not-sr-only">{t.next}</span>
        <ChevronRightIcon aria-hidden />
      </Button>
    </nav>
  );
}
