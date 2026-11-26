import type { Auth } from "../auth/auth.service";
import { assertFresh, roleGuard } from "../auth/role.guard";
import { revokeAllSessions } from "../auth/sessions.service";
import {
  dataKeyFileName,
  dataKeyState,
  exportDataKeyText,
  getSecurityStatus,
  markDataKeyExported,
  resetUnreadableSettings,
} from "../data-key.service";
import type { Db } from "../db/client";
import { ApiError } from "./http.error";
import { panelOnError } from "./panel.routes";

/** What /dev/security needs: DB + data key, the public URL, and whether boot created the key file. */
export type SecurityDeps = { db: Db; secret: string; appBaseUrl: string; createdThisBoot: boolean };

/** RESET_CONFIRM is the word the owner types to delete unreadable secret settings (DataKeyResetInput). */
const RESET_CONFIRM = "hapus";

/** super_admin security API under /dev: status, data key download/reset (fresh session), sign out everyone. */
export function createSecurityRoutes(auth: Auth, { db, secret, appBaseUrl, createdThisBoot }: SecurityDeps) {
  const deps = { db, secret };
  const status = () => getSecurityStatus(deps, { appBaseUrl, createdThisBoot });
  return (
    roleGuard(auth, "/dev", "super_admin")
      .onError(panelOnError as never)
      .get("/security", status)
      .post("/security/data-key/export", ({ user, session }) => {
        assertFresh(session);
        if (dataKeyState(deps).state === "mismatch")
          throw new ApiError(409, "key_mismatch", "the data key does not match the stored settings; fix it first");
        const now = new Date();
        const text = exportDataKeyText(secret, appBaseUrl, now);
        markDataKeyExported(db, user.id, now);
        return new Response(text, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": `attachment; filename="${dataKeyFileName(now)}"`,
            "cache-control": "no-store",
          },
        });
      })
      .post("/security/data-key/reset", ({ body, user, session }) => {
        assertFresh(session);
        const confirm = typeof body === "object" && body !== null ? (body as { confirm?: unknown }).confirm : undefined;
        if (confirm !== RESET_CONFIRM)
          throw new ApiError(400, "confirm_mismatch", `type "${RESET_CONFIRM}" to confirm the reset`);
        if (dataKeyState(deps).state === "ok") throw new ApiError(409, "key_ok", "every secret setting is readable");
        resetUnreadableSettings(deps, user.id);
        return status();
      })
      // Audit `session.revoke_all` and the log line are written by revokeAllSessions.
      .post("/sessions/revoke-all", ({ session }) => revokeAllSessions(db, session.id))
  );
}
