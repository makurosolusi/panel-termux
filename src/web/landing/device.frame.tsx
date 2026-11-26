import type { ReactNode } from "react";

/** Phone bezel around a screenshot (decorative frame; the screenshot carries the alt text). */
export function PhoneFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[2.4rem] border border-lp-ink/30 bg-lp-ink/90 p-2 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.55)] dark:bg-black ${className}`}
    >
      <div className="overflow-hidden rounded-[2rem] bg-lp-screen">{children}</div>
    </div>
  );
}

/** Minimal browser window chrome around a desktop screenshot. */
export function BrowserFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-lp-line bg-lp-screen shadow-[0_30px_60px_-30px_rgb(0_0_0/0.45)] ${className}`}
    >
      <div aria-hidden className="flex h-7 items-center gap-1.5 border-b border-white/10 px-3">
        <span className="size-2 rounded-full bg-white/20" />
        <span className="size-2 rounded-full bg-white/20" />
        <span className="size-2 rounded-full bg-white/20" />
      </div>
      {children}
    </div>
  );
}
