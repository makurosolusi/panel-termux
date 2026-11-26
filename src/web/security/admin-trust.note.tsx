import { idSecurity } from "@/web/i18n/id.security";
import { Notice } from "./security.notice";

/** What the Admin role can do on this phone; shown in the role dialog and on Pengguna (PLAN/05). */
export function AdminTrustNote() {
  return (
    <Notice tone="warning">
      <p>{idSecurity.adminTrust}</p>
    </Notice>
  );
}
