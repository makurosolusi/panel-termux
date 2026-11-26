import { cn } from "cn";
import { CopyButton } from "./copy-button";

/** Monospace identifier (hostname, path, command); `copy` adds a copy button. Long values wrap anywhere. */
export function InlineCode({
  children,
  copy = false,
  className,
}: {
  children: string;
  copy?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-0.5 align-middle", className)}>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125em] break-all">{children}</code>
      {copy && <CopyButton value={children} />}
    </span>
  );
}
