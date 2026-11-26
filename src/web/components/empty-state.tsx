import { cn } from "cn";
import { InboxIcon, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CodeText } from "@/web/components/code-text";

/** "Nothing here yet" block: icon, title, optional description and primary action. */
export function EmptyState({
  title,
  description,
  icon: Icon = InboxIcon,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center text-sm",
        className,
      )}
    >
      <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-muted-foreground">
          <CodeText>{description}</CodeText>
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
