import type { Role } from "@/shared/roles";
import { Badge } from "@/web/components/ui/badge";
import { id } from "@/web/i18n/id";

const VARIANT = { user: "secondary", admin: "default", super_admin: "destructive" } as const satisfies Record<
  Role,
  "secondary" | "default" | "destructive"
>;

/** Localized role label. */
export function RoleBadge({ role }: { role: Role }) {
  return <Badge variant={VARIANT[role]}>{id.roles[role]}</Badge>;
}
