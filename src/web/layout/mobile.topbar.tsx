import { ChevronLeftIcon } from "lucide-react";
import { Link } from "react-router";
import type { PageBack } from "@/web/components/page-header";
import { id } from "@/web/i18n/id";
import type { Me } from "@/web/session/session.api";
import { UserMenu } from "./user.menu";

/**
 * Phone top bar (< md): "‹" back link when the page has a parent, the page title (aria-hidden: the page's h1 is the
 * accessible title), and the account menu only for roles without a bottom bar.
 */
export function MobileTopBar({
  title,
  back,
  me,
  withMenu,
}: {
  title: string | null;
  back?: PageBack;
  me: Me;
  withMenu: boolean;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
      <div className="flex h-12 items-center gap-1 px-2">
        {back ? (
          <Link
            to={back.to}
            aria-label={id.shell.mobileNav.back(back.label)}
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeftIcon className="size-5" aria-hidden />
          </Link>
        ) : (
          <span className="w-2 shrink-0" aria-hidden />
        )}
        <span aria-hidden className="min-w-0 flex-1 truncate text-base font-semibold">
          {title}
        </span>
        {withMenu && (
          <div className="shrink-0">
            <UserMenu me={me} compact side="bottom" />
          </div>
        )}
      </div>
    </header>
  );
}
