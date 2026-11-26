import { cn } from "cn";
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/web/components/ui/button";
import { idCommon } from "@/web/i18n/id.common";

/**
 * Failed load: danger-toned panel with message and optional retry (and any extra action). `compact` = one line,
 * for a single section that failed on its own inside an otherwise working page.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  action,
  compact = false,
  className,
}: {
  title: string;
  description?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const actions = (onRetry || action) && (
    <div className="flex shrink-0 gap-2">
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} aria-busy={retrying || undefined}>
          {idCommon.retry}
        </Button>
      )}
      {action}
    </div>
  );
  if (compact) {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-danger/25 bg-danger-subtle px-3 py-2 text-sm",
          className,
        )}
      >
        <TriangleAlertIcon className="size-4 shrink-0 text-danger" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium text-danger">{title}</span>
          {description && <span className="text-foreground/80"> {description}</span>}
        </p>
        {actions}
      </div>
    );
  }
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-danger/25 bg-danger-subtle p-4 text-sm sm:flex-row sm:items-start",
        className,
      )}
    >
      <TriangleAlertIcon className="size-5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-danger">{title}</p>
        {description && <p className="mt-1 text-foreground/80">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
