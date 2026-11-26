import { cn } from "cn";
import type { ReactNode } from "react";

/**
 * Primary buttons of a task route (wizard Back/Next, editor Save). Phones: fixed above the bottom nav (or the screen
 * edge when the task route hides it) and sets `--action-bar-h` via `data-action-bar`; ≥ md: a plain static footer.
 */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      {/* reserves the fixed bar's height so the last content row stays reachable on phones */}
      <div aria-hidden className="h-16 md:hidden" />
      <div
        data-action-bar
        className={cn(
          "fixed inset-x-0 bottom-[var(--bottom-nav-h,0px)] z-30 flex items-center justify-end gap-2 border-t bg-background/95 min-h-16 px-4 pt-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] backdrop-blur",
          "md:static md:z-auto md:mt-6 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none",
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
