// Audit entry → readable sentence in the active locale (PLAN/05 §5.4). Pure: tested in tests/web.dev.test.ts.
import type { AuditAction } from "@/shared/audit.types";
import type { DevAuditEntry } from "@/shared/dev.types";
import { normalizeDeviceLabel } from "@/shared/device.label";
import { isRole } from "@/shared/roles";
import type { StatusTone } from "@/web/components/status.tone";
import { tApp } from "@/web/i18n/en.app";
import { tDevAudit } from "@/web/i18n/en.dev.audit";
import { tDevSetup } from "@/web/i18n/en.dev.setup";
import { tSettings } from "@/web/i18n/en.settings";

const t = tDevAudit;
const s = t.s;

/** Sentence + row tone; `neutral` rows get no coloured edge. */
export type AuditDescription = { text: string; tone: StatusTone };

/** Display name of who did it: System / "{label} (deleted)" / name / Unknown (label survives deletion). */
export function auditActor(e: DevAuditEntry): string {
  const kind = e.actorKind ?? (e.actor ? "user" : "unknown");
  if (kind === "system") return t.system;
  if (kind === "unknown") return t.unknownActor;
  const label = e.actor?.name || e.actorLabel || e.actorEmail || t.unknownActor;
  return e.actorDeleted || !e.actor ? t.deletedActor(label) : label;
}

/**
 * Device of the request behind a row: stored label normalized (old "Chrome di Android" → "Chrome · Android", E10),
 * unknown → `tDevAudit.unknownDevice`; null for rows without a request (no IP and no label, e.g. system actions).
 */
export function auditDevice(e: DevAuditEntry): string | null {
  if (!e.ipMasked && !e.userAgent) return null;
  return normalizeDeviceLabel(e.userAgent ?? null) ?? t.unknownDevice;
}

type Ctx = { a: string; target: string; m: Record<string, unknown>; e: DevAuditEntry };

const str = (v: unknown, fallback = ""): string => (typeof v === "string" && v ? v : fallback);
const num = (v: unknown): number => (typeof v === "number" ? v : 0);
const role = (v: unknown): string => (typeof v === "string" && isRole(v) ? tApp.roles[v] : str(v, "?"));
const who = (c: Ctx): string => str(c.m.targetEmail, t.otherUser);
const settingLabel = (key: string): string =>
  (tSettings.fields as Record<string, { label: string } | undefined>)[key]?.label ?? key;
const setupLabel = (key: string): string =>
  (tDevSetup.items as Record<string, { title: string } | undefined>)[key]?.title ?? key;

function backupRun(c: Ctx): string {
  const base = c.e.actorKind === "system" || c.m.trigger === "schedule" ? s.backupScheduled : s.backupRun(c.a);
  return c.m.status === "failed" ? s.backupFailed(base) : base;
}

function sessionRevoke(c: Ctx): string {
  if (c.m.scope === "one") return s.sessionOne(c.a);
  if (c.m.scope === "others") return s.sessionOthers(c.a, num(c.m.count));
  // No count in the meta (older rows) → "out of all sessions", never a made-up "0 sessions" (QA m3).
  return s.sessionUser(c.a, who(c), typeof c.m.revoked === "number" ? c.m.revoked : null);
}

/** Target "app:<name>:<out|err>" / "service:<name>" (panel.service logFile) → readable; older rows hold a bare name. */
function logDownload(c: Ctx): string {
  const [kind, name, stream] = c.target.split(":");
  if (kind === "app" && name) return s.logDownloadApp(c.a, name, stream === "err");
  if (kind === "service" && name) return s.logDownloadService(c.a, name);
  return s.logDownload(c.a, c.target);
}

/** File label of an integration fix/restore: meta `file`, else the fix `key` (`sites_dir_create` has no file). */
const fixFile = (c: Ctx): string => {
  const k = str(c.m.file, str(c.m.key, "?"));
  return t.fixFiles[k] ?? k;
};

function pm2Restart(c: Ctx): string {
  const missing = num(c.m.missing);
  return missing ? s.integrationRestartMissing(c.a, missing) : s.integrationRestart(c.a);
}

const SENTENCES = {
  "auth.sign_in": (c) => s.signIn(c.a),
  "auth.sign_out": (c) => s.signOut(c.a),
  "auth.account_created": (c) => s.accountCreated(c.a),
  "user.role_change": (c) => s.roleChange(c.a, who(c), role(c.m.from), role(c.m.to)),
  "user.role_sync": (c) => s.roleSync(c.a, role(c.m.from), role(c.m.to)),
  "user.delete": (c) => s.userDelete(c.a, who(c)),
  "user.self_delete": (c) => s.selfDelete(str(c.m.targetEmail, c.a)),
  "settings.update": (c) => (c.m.reset ? s.settingsReset : s.settingsUpdate)(c.a, settingLabel(c.target)),
  "dns.create": (c) => s.dnsCreate(c.a, c.target),
  "dns.delete": (c) => s.dnsDelete(c.a, c.target),
  "service.start": (c) => s.service(c.a, t.verbs.start, c.target),
  "service.stop": (c) => s.service(c.a, t.verbs.stop, c.target),
  "service.restart": (c) => s.service(c.a, t.verbs.restart, c.target),
  "app.start": (c) => s.app(c.a, t.verbs.start, c.target),
  "app.stop": (c) => s.app(c.a, t.verbs.stop, c.target),
  "app.restart": (c) => s.app(c.a, t.verbs.restart, c.target),
  "site.create": (c) => s.siteCreate(c.a, c.target),
  "site.delete": (c) => s.siteDelete(c.a, c.target),
  "site.adopt": (c) => s.siteAdopt(c.a, c.target),
  "site.env_update": (c) => s.siteEnv(c.a, c.target),
  "site.deploy": (c) => s.siteDeploy(c.a, c.target),
  "site.rollback": (c) => s.siteRollback(c.a, c.target),
  "site.restart": (c) => s.siteRestart(c.a, c.target),
  "site.settings_update": (c) => s.siteSettings(c.a, c.target),
  "hostname.add": (c) => s.hostnameAdd(c.a, Array.isArray(c.m.hostnames) ? c.m.hostnames.join(", ") : "?", c.target),
  "hostname.remove": (c) => s.hostnameRemove(c.a, str(c.m.hostname, "?"), c.target),
  "backup.run": backupRun,
  "backup.download": (c) => s.backupDownload(c.a, c.target),
  "backup.verify": (c) => s.backupVerify(c.a, c.m.ok ? t.ok : t.failed),
  "cloudflare.verify": (c) => s.cloudflareVerify(c.a, c.m.ok ? t.ok : t.failed),
  "backup.prune": (c) => s.backupPrune(c.a),
  "backup.restore": (c) => s.backupRestore(c.a, c.target),
  "backup.restore_drop": (c) => s.backupRestoreDrop(c.a, c.target),
  "session.revoke": sessionRevoke,
  "session.revoke_all": (c) => s.sessionAll(c.a, num(c.m.count)),
  "secret.mismatch": (c) => s.secretMismatch(num(c.m.unreadable)),
  "secret.export": (c) => s.secretExport(c.a),
  "secret.reset": (c) => s.secretReset(c.a),
  "panel.start": (c) => s.panelStart(str(c.m.version, "?")),
  "audit.prune": (c) => s.auditPrune(num(c.m.deleted)),
  "audit.export": (c) => s.auditExport(c.a),
  "log.download": logDownload,
  "job.recover": (c) => s.jobRecover(c.a, c.target),
  "setup.update": (c) => s.setupUpdate(c.a, setupLabel(c.target), c.m.done ? t.done : t.notDone),
  "integration.fix": (c) => s.integrationFix(c.a, fixFile(c)),
  "integration.restore": (c) => s.integrationRestore(c.a, fixFile(c)),
  "integration.pm2_restart": pm2Restart,
} satisfies Record<AuditAction, (c: Ctx) => string>;

/** Actions worth a coloured edge: destructive or security-relevant. */
const TONES: Partial<Record<AuditAction, StatusTone>> = {
  "user.delete": "danger",
  "user.self_delete": "warning",
  "secret.reset": "danger",
  "secret.mismatch": "danger",
  "session.revoke_all": "warning",
  "site.delete": "warning",
  "backup.restore": "warning",
  "integration.restore": "warning",
};

function tone(e: DevAuditEntry, m: Record<string, unknown>): StatusTone {
  if (e.action === "backup.run" && m.status === "failed") return "danger";
  if (e.action === "integration.pm2_restart" && num(m.missing) > 0) return "warning";
  if ((e.action === "backup.verify" || e.action === "cloudflare.verify") && m.ok === false) return "warning";
  return TONES[e.action as AuditAction] ?? "neutral";
}

/** Sentence for one audit row; unknown/retired actions → "{actor} ran {action}". */
export function describeAudit(e: DevAuditEntry): AuditDescription {
  const c: Ctx = { a: auditActor(e), target: e.target ?? "?", m: e.meta ?? {}, e };
  const fn = (SENTENCES as Record<string, ((c: Ctx) => string) | undefined>)[e.action];
  return { text: fn ? fn(c) : t.fallback(c.a, e.action), tone: tone(e, c.m) };
}

// ---- filters: the page URL uses the API's own params, so filter → query is a pick (F6) ----

/** Query params shared by the page URL, GET /api/dev/audit and export.csv. `action` may repeat (prefix = trailing "."). */
export const AUDIT_FILTER_KEYS = ["action", "actorId", "from", "to"] as const;

/** Action-group options of the filter (one prefix each). */
export const AUDIT_PREFIXES = Object.keys(t.prefixes).filter((k) => k !== "all");

/** Only the filter params of `params` (non-empty), in a stable order; `action` keeps every value. */
export function auditFilterParams(params: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of AUDIT_FILTER_KEYS) for (const v of params.getAll(key)) if (v) out.append(key, v);
  return out;
}

/** GET /api/dev/audit URL for the page's filters + page. */
export function auditListUrl(params: URLSearchParams, page: number, pageSize: number): string {
  const q = auditFilterParams(params);
  q.set("page", String(page));
  q.set("pageSize", String(pageSize));
  return `/api/dev/audit?${q}`;
}

/** CSV download link carrying the same filters as the list. */
export function auditExportUrl(params: URLSearchParams): string {
  const q = auditFilterParams(params).toString();
  return `/api/dev/audit/export.csv${q ? `?${q}` : ""}`;
}

/** Any filter active (decides between "nothing yet" and "nothing matches"). */
export const isAuditFiltered = (params: URLSearchParams): boolean => auditFilterParams(params).size > 0;

/** `from` after `to` (local YYYY-MM-DD compares lexically): show the inline date error, do not query. */
export const invalidDateRange = (from: string | null, to: string | null): boolean => Boolean(from && to && from > to);
