import { ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";
import { id } from "@/web/i18n/id";
import type { Crumb } from "./nav.items";

/** "Server › Situs › blog" trail; the last crumb is the current page (aria-current). */
export function Breadcrumbs({ crumbs }: { crumbs: readonly Crumb[] }) {
  if (crumbs.length === 0) return null;
  return (
    <nav aria-label={id.shell.breadcrumb} className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.to ?? c.label} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRightIcon className="size-3.5 shrink-0 opacity-60" aria-hidden />}
              <span className="min-w-0 truncate">
                {last ? (
                  <span aria-current="page" className="font-medium text-foreground">
                    {c.label}
                  </span>
                ) : c.to ? (
                  <Link to={c.to} className="rounded-sm hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  c.label
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
