import { tSecurity } from "@/web/i18n/en.security";
import { Notice } from "./security.notice";

/** What the Admin role can do on this phone; shown in the role dialog and on Users (PLAN/05). */
export function AdminTrustNote() {
  return (
    <Notice tone="warning">
      <p>{tSecurity.adminTrust}</p>
    </Notice>
  );
}
