import { LogOutIcon } from "lucide-react";
import { useSignOut } from "@/web/auth/use-sign-out";
import { RoleBadge } from "@/web/components/role-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { UserAvatar } from "@/web/components/user-avatar";
import { id } from "@/web/i18n/id";
import type { Me } from "@/web/session/session.api";

/** Avatar button opening the account menu (identity + sign-out). */
export function UserMenu({ me }: { me: Me }) {
  const { signOut, pending, error } = useSignOut();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={id.menu.account}
      >
        <UserAvatar me={me} className="size-9" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="truncate">{me.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">{me.email}</span>
          <span>
            <RoleBadge role={me.role} />
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={(e) => {
            e.preventDefault(); // keep menu open so a failure message stays visible
            void signOut();
          }}
        >
          <LogOutIcon />
          {id.menu.signOut}
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
