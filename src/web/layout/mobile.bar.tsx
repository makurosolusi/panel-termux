import { MenuIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@/web/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/web/components/ui/sheet";
import { id } from "@/web/i18n/id";
import type { Me } from "@/web/session/session.api";
import { BrandLogo } from "./brand.logo";
import type { NavGroup } from "./nav.items";
import { SidebarNav } from "./sidebar.nav";
import { UserMenu } from "./user.menu";

const t = id.shell.sidebar;

/** Phone top bar (< md): logo + menu button opening a left sheet with the full navigation and account menu. */
export function MobileBar({ me, groups, home }: { me: Me; groups: readonly NavGroup[]; home: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur md:hidden">
      <Link to={home} className="rounded-md">
        <BrandLogo />
      </Link>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="ml-auto" aria-label={t.openMenu}>
            <MenuIcon aria-hidden />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="flex w-72 flex-col gap-0 bg-sidebar p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle asChild>
              <span>
                <BrandLogo />
              </span>
            </SheetTitle>
            <SheetDescription className="sr-only">{t.menuTitle}</SheetDescription>
          </SheetHeader>
          <nav aria-label={t.label} className="flex-1 overflow-y-auto px-3 py-4">
            <SidebarNav groups={groups} onNavigate={() => setOpen(false)} />
          </nav>
          <div className="border-t p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <UserMenu me={me} />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
