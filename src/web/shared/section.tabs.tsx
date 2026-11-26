import { cn } from "cn";
import { NavLink } from "react-router";

/** One section tab; `end` = active only on the exact path (for index routes). */
export type SectionTab = { to: string; label: string; end?: boolean };

/** Underlined section tabs under a page header, horizontally scrollable on phones. */
export function SectionTabs({ label, tabs }: { label: string; tabs: readonly SectionTab[] }) {
  return (
    <nav aria-label={label} className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex min-w-full gap-1 border-b sm:min-w-0">
        {tabs.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            end={s.end}
            className={({ isActive }) =>
              cn(
                "-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground",
                isActive && "border-primary font-medium text-foreground",
              )
            }
          >
            {s.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
