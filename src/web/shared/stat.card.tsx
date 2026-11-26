import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card, CardContent } from "@/web/components/ui/card";

/** One metric card: icon + label, big value, optional detail below. */
export function StatCard({
  icon: Icon,
  label,
  value,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden />
          {label}
        </span>
        <span className="truncate text-2xl font-semibold tabular-nums">{value}</span>
        {children && <div className="text-xs text-muted-foreground">{children}</div>}
      </CardContent>
    </Card>
  );
}
