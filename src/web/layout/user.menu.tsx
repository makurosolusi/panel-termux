import { cn } from "cn";
import { ChevronsUpDownIcon, LogOutIcon, MonitorIcon, MoonIcon, SunIcon, UserIcon } from "lucide-react";
import { Link } from "react-router";
import { useSignOut } from "@/web/auth/use-sign-out";
import { RoleBadge } from "@/web/components/role-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { UserAvatar } from "@/web/components/user-avatar";
import { idApp } from "@/web/i18n/id.app";
import { idShell } from "@/web/i18n/id.shell";
import type { Me } from "@/web/session/session.api";
import { parsePreference } from "@/web/theme/theme.preference";
import { setThemePreference, useTheme } from "@/web/theme/theme.store";

const t = idShell;
const THEME_OPTIONS = [
  { value: "system", label: t.theme.system, icon: MonitorIcon },
  { value: "light", label: t.theme.light, icon: SunIcon },
  { value: "dark", label: t.theme.dark, icon: MoonIcon },
] as const;

/**
 * Account menu (sidebar bottom, or the phone top bar for roles without a bottom bar): avatar, name, role; menu with
 * theme switch, profile, sign-out. `side` = where the menu opens.
 */
export function UserMenu({
  me,
  compact = false,
  side = "top",
}: {
  me: Me;
  compact?: boolean;
  side?: "top" | "bottom";
}) {
  const { signOut, pending, error } = useSignOut();
  const { preference } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.account}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-accent",
          compact && "w-auto justify-center",
        )}
      >
        <UserAvatar me={me} className="size-8" />
        {!compact && (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{me.name}</span>
              <span className="truncate text-xs text-muted-foreground">{idApp.roles[me.role]}</span>
            </span>
            <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={side} align={side === "top" ? "start" : "end"} className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate">{me.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{me.email}</span>
          <RoleBadge role={me.role} className="mt-1" />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{t.theme.label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={preference} onValueChange={(v) => setThemePreference(parsePreference(v))}>
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} onSelect={(e) => e.preventDefault()}>
              <Icon aria-hidden />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserIcon aria-hidden />
            {t.nav.profile}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={(e) => {
            e.preventDefault(); // keep menu open so a failure message stays visible
            void signOut();
          }}
        >
          <LogOutIcon aria-hidden />
          {idApp.menu.signOut}
        </DropdownMenuItem>
        {error && (
          <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
