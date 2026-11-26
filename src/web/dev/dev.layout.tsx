import { NavLink, Outlet } from "react-router";
import { PageHeader } from "@/web/components/page-header";
import { Toaster } from "@/web/components/ui/sonner";
import { id } from "@/web/i18n/id";
import { cn } from "@/web/lib/cn";

const SECTIONS = [
  { to: "/dev", label: id.dev.sections.health, end: true },
  { to: "/dev/users", label: id.dev.sections.users },
  { to: "/dev/invites", label: id.dev.sections.invites },
  { to: "/dev/audit", label: id.dev.sections.audit },
  { to: "/dev/logs", label: id.dev.sections.logs },
  { to: "/dev/settings", label: id.dev.sections.settings },
] as const;

/** /dev shell: title, section tabs (horizontally scrollable on phones) and the toast outlet. */
export function DevLayout() {
  return (
    <>
      <PageHeader title={id.dev.title} subtitle={id.dev.subtitle} />
      <nav aria-label={id.dev.sections.label} className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex min-w-full gap-1 border-b sm:min-w-0">
          {SECTIONS.map((s) => (
            <NavLink
              key={s.to}
              to={s.to}
              end={"end" in s}
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
      <Outlet />
      <Toaster position="top-center" richColors />
    </>
  );
}
