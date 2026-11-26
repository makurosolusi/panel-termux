import type { BackupVerifyInput } from "../../shared/backup.types";
import type { Auth } from "../auth/auth.service";
import { roleGuard } from "../auth/role.guard";
import { parsePaging } from "../routes/http.error";
import { panelOnError } from "../routes/panel.routes";
import { type BackupDeps, backupServiceFor } from "./backup.service";

const HTTP_FOUND = 302;
const DRAFT_FIELDS = ["endpoint", "bucket", "region", "accessKeyId", "secretAccessKey", "prefix"] as const;

/** Only the known string fields of an optional verify draft (anything else is ignored). */
function draftOf(body: unknown): BackupVerifyInput {
  const src = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const out: BackupVerifyInput = {};
  for (const k of DRAFT_FIELDS) if (typeof src[k] === "string") out[k] = src[k];
  return out;
}

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
    .get("/:id/items/:index/download", ({ params, user, session, redirect }) =>
      redirect(backup.downloadUrl({ id: user.id, role: user.role, session }, params.id, params.index), HTTP_FOUND),
    )
    .post("/:id/items/:index/restore", async ({ params, user, status }) =>
      status(202, await backup.restores.start(user.id, params.id, params.index)),
    )
    .get("/restores", ({ query }) => backup.restores.list(parsePaging(query)))
    .delete("/restores/:id/database", async ({ params, user, body, status }) => {
      await backup.restores.drop(user.id, params.id, (body as { confirm?: unknown } | null)?.confirm);
      return status(204);
    });
}

/** super_admin S3 connection test at /dev/backup/verify (DECISIONS B7); body = optional unsaved draft. */
export function createBackupDevRoutes(deps: BackupDeps & { auth: Auth }) {
  const backup = backupServiceFor(deps);
  return roleGuard(deps.auth, "/dev/backup", "super_admin")
    .onError(panelOnError as never)
    .post("/verify", ({ user, body }) => backup.verify(user.id, draftOf(body)));
}
