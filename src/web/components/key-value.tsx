import { cn } from "cn";
import type { ReactNode } from "react";

/** One row of a KeyValue list; `mono` renders the value as an identifier. */
export type KeyValueItem = { label: string; value: ReactNode; mono?: boolean };

/** Label/value description list: two columns from `sm`, stacked on phones. */
export function KeyValue({ items, className }: { items: readonly KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,auto)_1fr]", className)}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className={cn("min-w-0 break-words tabular-nums", item.mono && "font-mono text-[0.8125rem]")}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
