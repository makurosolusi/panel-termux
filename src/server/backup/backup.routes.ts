import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import { parsePaging } from "../routes/http.error";
import { panelOnError } from "../routes/panel.routes";
import { type BackupDeps, backupServiceFor } from "./backup.service";

const HTTP_FOUND = 302;

/** admin backup API at /panel/backups (mount under the /api prefix); applies its own admin guard. */
export function createBackupRoutes(deps: BackupDeps & { auth: Auth }) {
  const backup = backupServiceFor(deps);
  return roleGuard(deps.auth, "/panel/backups", "admin")
    .onError(panelOnError as never)
    .get("/status", () => backup.status())
    .get("/", ({ query }) => backup.list(parsePaging(query)))
    .post("/run", ({ user, status }) => {
      const missing = backup.missing();
      if (missing.length)
        return status(400, {
          error: "not_configured",
          message: `missing settings: ${missing.join(", ")}`,
          missing,
        });
      return status(202, backup.start("manual", user.id));
    })
    .get("/:id/items/:index/download", ({ params, user, redirect }) =>
      redirect(backup.downloadUrl(user.id, params.id, params.index), HTTP_FOUND),
    );
}
