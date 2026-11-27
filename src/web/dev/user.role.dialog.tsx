import type { AssignableRole, DevUser } from "@/shared/dev.types";
import { ConfirmAction } from "@/web/components/confirm-action";
import { tApp } from "@/web/i18n/en.app";
import { tDevUsers } from "@/web/i18n/en.dev.users";
import { AdminTrustNote } from "@/web/security/admin-trust.note";
import { ACCESS_GUIDE_URL } from "./onboarding.state";

const t = tDevUsers;
const r = t.roleDialog;

/**
 * "Ubah peran" confirmation for one target role (chosen in the ⋯ menu). Promoting to Admin is an honest confirm:
 * what Admin can do on this phone, plus the reminder to add the email to the Cloudflare Access policy.
 */
export function UserRoleDialog({
  user,
  to,
  open,
  onOpenChange,
  onConfirm,
}: {
  user: DevUser;
  to: AssignableRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<unknown>;
}) {
  const name = user.name || user.email;
  return (
    <ConfirmAction
      open={open}
      onOpenChange={onOpenChange}
      title={r.title(name)}
      description={
        <>
          <span className="font-medium text-foreground">{to === "admin" ? r.admin : r.user}</span>
          {to === "admin" && (
            <>
              <AdminTrustNote />
              <span>
                {r.accessNote(user.email)}{" "}
                <a href={ACCESS_GUIDE_URL} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  {r.accessLink}
                </a>
              </span>
            </>
          )}
          <span>{r.immediate}</span>
        </>
      }
      confirmLabel={to === "admin" ? r.makeAdmin : r.makeUser}
      codes={t.errorCodes}
      successToast={t.roleChangedTo(name, tApp.roles[to])}
      onConfirm={onConfirm}
    />
  );
}
