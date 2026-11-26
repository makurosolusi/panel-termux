import { EllipsisIcon, LockIcon, LogOutIcon, ShieldIcon, Trash2Icon, UserIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { AssignableRole, DevUser } from "@/shared/dev.types";
import type { RevokedSessions } from "@/shared/security.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import type { DataColumn } from "@/web/components/data-table";
import { RoleBadge } from "@/web/components/role-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/web/components/ui/avatar";
import { Button } from "@/web/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/web/components/ui/dropdown-menu";
import { idDevUsers } from "@/web/i18n/id.dev.users";
import { apiFetch } from "@/web/shared/api.client";
import { UserRoleDialog } from "./user.role.dialog";

const t = idDevUsers;
const DAY_MS = 86_400_000;

/** Which row actions a user gets: none for yourself (gembok), only "keluarkan" for env super admins (F5.5, K21). */
export type UserActionSet = { locked: "self" | "env" | null; role: boolean; revoke: boolean; delete: boolean };

/** Action availability for `u` as seen by `meId` (mirrors the server's 409 `protected`/`self`). */
export function userActions(u: DevUser, meId: string): UserActionSet {
  if (u.id === meId) return { locked: "self", role: false, revoke: false, delete: false };
  if (u.isEnvSuperAdmin) return { locked: "env", role: false, revoke: true, delete: false };
  return { locked: null, role: true, revoke: true, delete: true };
}

/** Last activity at day resolution (K9), local calendar days: "Aktif hari ini" / "kemarin" / "N hari lalu". */
export function lastSeenText(iso: string | null, now: Date = new Date()): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return t.neverSeen;
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.max(0, Math.round((day(now) - day(d)) / DAY_MS));
  return days === 0 ? t.seenToday : days === 1 ? t.seenYesterday : t.seenDaysAgo(days);
}

const userUrl = (u: DevUser, rest = "") => `/api/dev/users/${encodeURIComponent(u.id)}${rest}`;
const display = (u: DevUser) => u.name || u.email;

function Who({ u, meId }: { u: DevUser; meId: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar className="size-8 shrink-0">
        {u.image && <AvatarImage src={u.image} alt="" referrerPolicy="no-referrer" />}
        <AvatarFallback>{display(u).slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {display(u)}
          {u.id === meId && <span className="ml-2 text-xs font-normal text-muted-foreground">({t.you})</span>}
        </span>
        <span className="block truncate text-xs font-normal text-muted-foreground">{u.email}</span>
      </span>
    </span>
  );
}

/** Table/card columns of /dev/users; `now` keeps "Aktif hari ini" consistent across rows. */
export const userColumns = (meId: string, now: Date): DataColumn<DevUser>[] => [
  { key: "name", header: t.name, mobile: "title", className: "max-w-72", cell: (u) => <Who u={u} meId={meId} /> },
  { key: "role", header: t.role, mobile: "badge", cell: (u) => <RoleBadge role={u.role} /> },
  { key: "seen", header: t.lastSeen, cell: (u) => lastSeenText(u.lastSeenAt, now) },
  { key: "sessions", header: t.sessionCount, align: "right", cell: (u) => t.sessions(u.activeSessions ?? 0) },
];

type Open = { kind: "role"; to: AssignableRole } | { kind: "revoke" } | { kind: "delete" } | null;

/** ⋯ menu of one user (or a lock with the reason), with its confirm dialogs. `onChanged` reloads the list. */
export function UserRowActions({ u, meId, onChanged }: { u: DevUser; meId: string; onChanged: () => void }) {
  const [open, setOpen] = useState<Open>(null);
  const can = userActions(u, meId);
  const name = display(u);
  const close = (o: boolean) => !o && setOpen(null);
  // reload on failure too: a 404/409 usually means the list is stale
  const run = <T,>(p: Promise<T>) => p.finally(onChanged);

  if (can.locked === "self")
    return (
      <span className="inline-flex size-9 items-center justify-center" title={t.lockedSelf}>
        <LockIcon className="size-4 text-muted-foreground" aria-hidden />
        <span className="sr-only">{t.lockedSelf}</span>
      </span>
    );
  const to: AssignableRole = u.role === "admin" ? "user" : "admin";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t.more(name)} title={t.more(name)} className="ml-auto">
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          {can.role && (
            <DropdownMenuItem onSelect={() => setOpen({ kind: "role", to })}>
              {to === "admin" ? <ShieldIcon aria-hidden /> : <UserIcon aria-hidden />}
              {to === "admin" ? t.roleDialog.makeAdmin : t.roleDialog.makeUser}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={u.activeSessions === 0} onSelect={() => setOpen({ kind: "revoke" })}>
            <LogOutIcon aria-hidden />
            {t.revoke}
          </DropdownMenuItem>
          {can.delete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setOpen({ kind: "delete" })}>
                <Trash2Icon aria-hidden />
                {t.delete}
              </DropdownMenuItem>
            </>
          )}
          {can.locked === "env" && <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground">{t.lockedEnv}</p>}
        </DropdownMenuContent>
      </DropdownMenu>
      {open?.kind === "role" && (
        <UserRoleDialog
          user={u}
          to={open.to}
          open
          onOpenChange={close}
          onConfirm={() => run(apiFetch<DevUser>("PATCH", userUrl(u), { role: open.to }))}
        />
      )}
      <ConfirmAction
        open={open?.kind === "revoke"}
        onOpenChange={close}
        title={t.revokeTitle(name)}
        description={t.revokeBody}
        confirmLabel={t.revoke}
        codes={t.errorCodes}
        onConfirm={async () => {
          const { revoked } = await run(apiFetch<RevokedSessions>("POST", userUrl(u, "/sessions/revoke")));
          toast.success(t.revoked(name, revoked));
        }}
      />
      {can.delete && (
        <ConfirmAction
          tier="typed"
          typedValue={u.email}
          destructive
          open={open?.kind === "delete"}
          onOpenChange={close}
          title={t.deleteTitle(name)}
          description={t.deleteBody(name)}
          confirmLabel={t.delete}
          codes={t.errorCodes}
          successToast={t.deleted}
          onConfirm={() => run(apiFetch<void>("DELETE", userUrl(u)))}
        />
      )}
    </>
  );
}
