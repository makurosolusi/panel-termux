import { LockIcon } from "lucide-react";
import type { AssignableRole, DevUser } from "@/shared/dev.types";
import { RoleBadge } from "@/web/components/role-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/web/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/web/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/web/components/ui/table";
import { id } from "@/web/i18n/id";
import { ConfirmDelete } from "./confirm.dialog";
import { formatDateTime } from "./dev.format";

const t = id.dev.users;
const ASSIGNABLE: readonly AssignableRole[] = ["user", "admin"];

/** Row callbacks; `meId` marks the signed-in account (shown locked). */
export type UserActions = {
  meId: string;
  busyId: string | null;
  onRole: (u: DevUser, role: AssignableRole) => void;
  onDelete: (u: DevUser) => void;
};

/** Env super admins and the signed-in account cannot be changed or deleted (server answers 409 `protected`). */
export const isLockedUser = (u: DevUser, meId: string): boolean => u.isEnvSuperAdmin || u.id === meId;

function Who({ u, meId }: { u: DevUser; meId: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar className="size-8">
        {u.image && <AvatarImage src={u.image} alt="" referrerPolicy="no-referrer" />}
        <AvatarFallback>{(u.name || u.email).slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium">
          {u.name || u.email}
          {u.id === meId && <span className="ml-2 text-xs text-muted-foreground">({t.you})</span>}
        </p>
        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
      </div>
    </div>
  );
}

function RoleCell({ u, a }: { u: DevUser; a: UserActions }) {
  if (isLockedUser(u, a.meId) || u.role === "super_admin") {
    return (
      <span className="inline-flex items-center gap-1.5" title={u.isEnvSuperAdmin ? t.envSuperAdmin : t.locked}>
        <RoleBadge role={u.role} />
        <LockIcon className="size-3.5 text-muted-foreground" aria-label={t.locked} />
      </span>
    );
  }
  return (
    <Select value={u.role} disabled={a.busyId === u.id} onValueChange={(r) => a.onRole(u, r as AssignableRole)}>
      <SelectTrigger size="sm" className="w-32" aria-label={`${t.role}: ${u.email}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ASSIGNABLE.map((r) => (
          <SelectItem key={r} value={r}>
            {id.roles[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeleteCell({ u, a }: { u: DevUser; a: UserActions }) {
  if (isLockedUser(u, a.meId)) return null;
  return (
    <ConfirmDelete
      label={`${id.dev.common.delete} ${u.email}`}
      title={t.deleteTitle}
      description={t.deleteBody(u.email)}
      disabled={a.busyId === u.id}
      onConfirm={() => a.onDelete(u)}
    />
  );
}

/** Users as a table on ≥sm screens and as stacked cards on phones. */
export function UsersList({ items, actions }: { items: DevUser[]; actions: UserActions }) {
  return (
    <>
      <ul className="flex flex-col gap-2 sm:hidden">
        {items.map((u) => (
          <li key={u.id} className="flex flex-col gap-3 rounded-lg border p-3">
            <Who u={u} meId={actions.meId} />
            <div className="flex items-center justify-between gap-2">
              <RoleCell u={u} a={actions} />
              <DeleteCell u={u} a={actions} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t.lastSeen}: {u.lastSeenAt ? formatDateTime(u.lastSeenAt) : id.dev.common.never}
            </p>
          </li>
        ))}
      </ul>
      <Table className="hidden sm:table">
        <TableHeader>
          <TableRow>
            <TableHead>{t.name}</TableHead>
            <TableHead>{t.role}</TableHead>
            <TableHead>{t.lastSeen}</TableHead>
            <TableHead>{t.joined}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{t.actions}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="max-w-64">
                <Who u={u} meId={actions.meId} />
              </TableCell>
              <TableCell>
                <RoleCell u={u} a={actions} />
              </TableCell>
              <TableCell>{u.lastSeenAt ? formatDateTime(u.lastSeenAt) : id.dev.common.never}</TableCell>
              <TableCell>{formatDateTime(u.createdAt)}</TableCell>
              <TableCell>
                <DeleteCell u={u} a={actions} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
