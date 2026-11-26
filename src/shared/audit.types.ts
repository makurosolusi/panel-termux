// Audit actions of every PLAN (one union, PLAN/04 §3.3/§3.8). Stored as plain text: rows with retired actions
// (`auth.denied`, `invite.*` from the invite-only era) still list and filter fine.
import type { ControlAction } from "./panel.types";

/** Who wrote an audit row: a signed-in user, the panel itself, or a row from before actor kinds existed. */
export type AuditActorKind = "user" | "system" | "unknown";

/** Known audit actions for new events. Never rename; only add. */
export type AuditAction =
  // 0.2.x
  | "auth.sign_in"
  | "user.role_change"
  | "user.delete"
  | "settings.update"
  | "dns.create"
  | "dns.delete"
  | `service.${ControlAction}`
  | `app.${ControlAction}`
  | "site.create"
  | "site.delete"
  | "site.adopt"
  | "site.env_update"
  | "hostname.add"
  | "hostname.remove"
  | "backup.run"
  | "backup.download"
  | "site.deploy"
  | "site.rollback"
  | "session.revoke"
  // PLAN/04 §3.8
  | "auth.sign_out"
  | "auth.account_created"
  | "user.role_sync"
  | "secret.mismatch"
  | "secret.export"
  | "secret.reset"
  | "panel.start"
  | "backup.verify"
  | "backup.prune"
  | "session.revoke_all"
  | "backup.restore"
  | "backup.restore_drop"
  | "audit.prune"
  // PLAN/02 (C23: sensitive GET)
  | "log.download"
  // PLAN/03 (job kinds without a 0.2.x action, and recovery)
  | "site.restart"
  | "site.settings_update"
  | "job.recover"
  // PLAN/05
  | "setup.update"
  | "audit.export"
  | "user.self_delete";
