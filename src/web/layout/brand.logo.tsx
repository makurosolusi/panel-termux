import { cn } from "cn";
import { idApp } from "@/web/i18n/id.app";

/** Logomark: `>_` prompt in a rounded brand square (same artwork as the favicon). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md bg-brand font-mono text-[0.8rem] font-bold text-brand-foreground",
        className,
      )}
    >
      &gt;_
    </span>
  );
}

/** Mark + "Panel Termux" wordmark; `compact` shows the mark only (collapsed sidebar). */
export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <LogoMark />
      <span className={cn("truncate text-sm font-semibold tracking-tight", compact && "sr-only")}>{idApp.appName}</span>
    </span>
  );
}
