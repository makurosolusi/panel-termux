import type { Role } from "@/shared/roles";
import { tApp } from "@/web/i18n/en.app";
import type { StatusTone } from "./status.tone";
import { StatusBadge } from "./status-badge";

/** Role colour: super admin = brand accent (privileged, not dangerous), admin = info, user = neutral. */
export const ROLE_TONE = { user: "neutral", admin: "info", super_admin: "accent" } as const satisfies Record<
  Role,
  StatusTone
>;

/** Localized role label. */
export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return <StatusBadge tone={ROLE_TONE[role]} label={tApp.roles[role]} className={className} />;
}
