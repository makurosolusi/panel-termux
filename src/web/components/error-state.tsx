import { cn } from "cn";
import { AlertTriangleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";

/** Failed load: danger-toned panel with message and optional retry (and any extra action). */
export function ErrorState({
  title,
  description,
  onRetry,
  retrying = false,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-danger/25 bg-danger-subtle p-4 text-sm sm:flex-row sm:items-start",
        className,
      )}
    >
      <AlertTriangleIcon className="size-5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-danger">{title}</p>
        {description && <p className="mt-1 text-foreground/80">{description}</p>}
      </div>
      {(onRetry || action) && (
        <div className="flex shrink-0 gap-2">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
              {id.common.retry}
            </Button>
          )}
          {action}
        </div>
      )}
    </div>
  );
}
