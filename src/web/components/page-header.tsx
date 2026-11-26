import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";
import { RelativeTime } from "./relative-time";

const t = id.shell.time;

/** Freshness line for live pages: live dot + "Diperbarui 3 dtk lalu" + refresh button. */
export type PageMeta = {
  updatedAt?: string | Date | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Auto-refresh is on: shows a pulsing dot. */
  live?: boolean;
};

/** Page title row: h1, optional description, actions on the right, optional freshness meta under the title. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: PageMeta;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>}
        {meta && <MetaLine meta={meta} />}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

function MetaLine({ meta }: { meta: PageMeta }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      {meta.live && (
        <span className="relative flex size-2" title={t.live}>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-success" />
          <span className="sr-only">{t.live}</span>
        </span>
      )}
      {meta.updatedAt && <RelativeTime at={meta.updatedAt} format={id.common.updatedAgo} />}
      {meta.onRefresh && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={meta.onRefresh}
          disabled={meta.refreshing}
          aria-label={t.refresh}
          title={t.refresh}
        >
          <RefreshCwIcon className={cn(meta.refreshing && "animate-spin")} aria-hidden />
        </Button>
      )}
    </div>
  );
}
