import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useLayoutEffect } from "react";
import { CodeText } from "@/web/components/code-text";
import { Button } from "@/web/components/ui/button";
import { tCommon } from "@/web/i18n/en.common";
import { tShell } from "@/web/i18n/en.shell";
import { RelativeTime } from "./relative-time";

const t = tShell.time;

/** Freshness line for live pages: live dot + "Diperbarui 3 mnt lalu" + refresh button. */
export type PageMeta = {
  updatedAt?: string | Date | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Auto-refresh is on: shows a pulsing dot. */
  live?: boolean;
  /** The last refresh failed (pass `!!query.error`): warning dot + "gagal memperbarui" instead of the live dot. */
  stale?: boolean;
};

/** Link to the parent list; on phones it becomes the "‹" button of the top bar. */
export type PageBack = { to: string; label: string };

/** What a page tells the shell (phone top bar title + back button). */
export type ShellPage = { title: string; back?: PageBack };

/**
 * Registration channel PageHeader → shell. The shell layout provides the setter; without a provider (tests,
 * landing) registration is a no-op. A context instead of a layout import keeps components/ free of layout/.
 */
export const ShellPageContext = createContext<((page: ShellPage | null) => void) | null>(null);

/**
 * Page title row: the page's only h1 (`#page-title`, route focus target; visually hidden on phones where the top bar
 * shows the title), optional status badge, description, freshness meta and actions (below the title on phones).
 */
export function PageHeader({
  title,
  description,
  status,
  actions,
  meta,
  back,
  className,
}: {
  title: string;
  description?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  meta?: PageMeta;
  back?: PageBack;
  className?: string;
}) {
  const register = useContext(ShellPageContext);
  const backTo = back?.to;
  const backLabel = back?.label;
  // before paint, so the phone top bar never shows the static route title first and then flips
  useLayoutEffect(() => {
    if (!register) return;
    register({ title, back: backTo && backLabel ? { to: backTo, label: backLabel } : undefined });
    return () => register(null);
  }, [register, title, backTo, backLabel]);

  return (
    <header
      className={cn("mb-6 flex flex-col gap-3 max-md:mb-4 sm:flex-row sm:items-start sm:justify-between", className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1
            id="page-title"
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight text-balance outline-none max-md:sr-only sm:text-2xl"
          >
            {title}
          </h1>
          {status}
        </div>
        {description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            <CodeText>{description}</CodeText>
          </p>
        )}
        {meta && <MetaLine meta={meta} />}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

function MetaLine({ meta }: { meta: PageMeta }) {
  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      {meta.stale ? (
        <span className="flex items-center gap-1.5 font-medium text-warning">
          <span aria-hidden className="size-2 rounded-full bg-warning" />
          {t.stale}
        </span>
      ) : (
        meta.live && (
          <span className="relative flex size-2" title={t.live}>
            <span className="absolute inline-flex size-full rounded-full bg-success opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2 rounded-full bg-success" />
            <span className="sr-only">{t.live}</span>
          </span>
        )
      )}
      {meta.updatedAt && <RelativeTime at={meta.updatedAt} format={tCommon.updatedAgo} />}
      {meta.onRefresh && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={meta.onRefresh}
          disabled={meta.refreshing}
          aria-label={t.refresh}
          title={t.refresh}
        >
          <RefreshCwIcon className={cn(meta.refreshing && "motion-safe:animate-spin")} aria-hidden />
        </Button>
      )}
    </div>
  );
}
