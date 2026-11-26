// Pure decisions of /panel/sites/:name (banners, domains dialog, health settings, delete defaults).
import type { BackupLastGood } from "@/shared/backup.types";
import {
  HEALTH_TIMEOUT_DEFAULT_SEC,
  HEALTH_TIMEOUT_MAX_SEC,
  HEALTH_TIMEOUT_MIN_SEC,
  type HealthProbe,
  type Job,
  type SiteCheckRequest,
  type SiteCheckResult,
  type SiteDetail,
  type SiteHealthConfig,
  type SiteSettingsUpdate,
} from "@/shared/site.types";
import { idSiteDetail } from "@/web/i18n/id.site-detail";
import { cleanHost, issueText, noteText } from "./site.check";

const t = idSiteDetail;
const DAY_MS = 86_400_000;

/** Banner shown above the sections, in display order. */
export type SiteBanner = "running" | "busy_other" | "interrupted" | "restart_pending" | "blocker";

/** Which banners the detail shows; `interrupted` = an unresolved recoverable job of this site (from /jobs). */
export function siteBanners(site: SiteDetail, interrupted: Job | null): SiteBanner[] {
  const out: SiteBanner[] = [];
  if (site.activeJob) out.push(site.activeJob.target === site.name ? "running" : "busy_other");
  else if (interrupted && !interrupted.resolvedBy && interrupted.recoverMode) out.push("interrupted");
  if (site.restartPending) out.push("restart_pending");
  if (site.deployBlocker) out.push("blocker");
  return out;
}

/** Mutations wait while any site change runs (one lock for all sites). */
export const siteBusy = (site: Pick<SiteDetail, "activeJob">): boolean => Boolean(site.activeJob);

/** Toast of "Cek kesehatan". */
export function healthToast(p: HealthProbe): { ok: boolean; text: string } {
  if (p.status === null) return { ok: false, text: t.header.noAnswer(p.path) };
  if (p.ok) return { ok: true, text: t.header.healthy(p.status, p.path, p.ms ?? 0) };
  return { ok: false, text: t.header.unhealthy(p.status, p.path) };
}

/** Most domains one "Tambah domain" change takes (one job, one cloudflared restart). */
export const MAX_NEW_HOSTNAMES = 5;

/** Typed domains trimmed, lower-cased, blanks dropped, duplicates kept once. */
export const normalizeHostnames = (values: readonly string[]): string[] => [
  ...new Set(values.map(cleanHost).filter((v) => v !== "")),
];

/** Live check request (`scope: "hostname"`, DNS included) for the dialog's domains, or null when nothing is typed. */
export function hostnamesCheck(hosts: readonly string[]): SiteCheckRequest | null {
  const [first, ...rest] = hosts;
  return first ? { hostname: first, extraHostnames: rest, scope: "hostname" } : null;
}

/** Domains that blink when cloudflared restarts: every domain on the phone except `exclude`, sorted. */
export const blinkingHosts = (all: readonly string[], exclude: readonly string[] = []): string[] =>
  [...new Set(all)].filter((h) => !exclude.includes(h)).sort();

/** Problem (blocking) or note of one typed domain in a check result; null = fine or not checked yet. */
export function hostnameFeedback(
  result: SiteCheckResult | undefined,
  typed: string,
): { text: string; blocking: boolean } | null {
  const host = cleanHost(typed);
  if (!result || host === "") return null;
  const issue = result.issues.find((i) => i.field === "hostname" && (i.hostname ?? host) === host);
  if (issue) return { text: issueText(issue), blocking: true };
  const note = result.notes?.find((n) => n.hostname === host);
  return note ? { text: noteText(note), blocking: false } : null;
}

/** Health settings form (timeout as typed). */
export type HealthForm = { path: string; expect: SiteHealthConfig["expect"]; timeout: string };

/** Current health config of a site (0.2.x servers send none: defaults). */
export const healthOf = (site: Pick<SiteDetail, "health">): SiteHealthConfig =>
  site.health ?? { path: "/", expect: "lt500", timeoutSec: HEALTH_TIMEOUT_DEFAULT_SEC };

/** Form values for a config. */
export const healthForm = (h: SiteHealthConfig): HealthForm => ({
  path: h.path,
  expect: h.expect,
  timeout: String(h.timeoutSec),
});

/** Invalid fields of the form (path must start with `/` without spaces; timeout an integer within the bounds). */
export function healthFormErrors(f: HealthForm): { path?: true; timeout?: true } {
  const n = Number(f.timeout.trim());
  return {
    ...(/^\/\S*$/.test(f.path.trim()) && f.path.trim().length <= 512 ? {} : { path: true }),
    ...(Number.isInteger(n) && n >= HEALTH_TIMEOUT_MIN_SEC && n <= HEALTH_TIMEOUT_MAX_SEC ? {} : { timeout: true }),
  };
}

/** PATCH body with only the changed fields, or null when the form is invalid or unchanged. */
export function healthPatch(f: HealthForm, current: SiteHealthConfig): SiteSettingsUpdate | null {
  if (Object.keys(healthFormErrors(f)).length > 0) return null;
  const next: Partial<SiteHealthConfig> = {};
  if (f.path.trim() !== current.path) next.path = f.path.trim();
  if (f.expect !== current.expect) next.expect = f.expect;
  if (Number(f.timeout) !== current.timeoutSec) next.timeoutSec = Number(f.timeout);
  return Object.keys(next).length > 0 ? { health: next } : null;
}

/** Newest good backup of the site's database, if any. */
export const siteDbBackup = (site: Pick<SiteDetail, "database">, lastGood: readonly BackupLastGood[]) =>
  site.database ? (lastGood.find((g) => g.kind === "database" && g.name === site.database) ?? null) : null;

/** "Simpan database"/"Simpan folder" start checked when that item has no good backup from the last 24 hours. */
export function deleteDefaults(
  site: Pick<SiteDetail, "database">,
  lastGood: readonly BackupLastGood[],
  now: Date,
): { keepDatabase: boolean; keepData: boolean } {
  const stale = (g: BackupLastGood | null | undefined) => !g || now.getTime() - Date.parse(g.at) > DAY_MS;
  return {
    keepDatabase: site.database !== null && stale(siteDbBackup(site, lastGood)),
    keepData: stale(lastGood.find((g) => g.kind === "sites")),
  };
}

/** Query string of DELETE /sites/:name: managed sites send the typed name and both keep flags; adopted none. */
export function deleteQuery(managed: boolean, typed: string, keep: { data: boolean; database: boolean }): string {
  if (!managed) return "";
  const q = new URLSearchParams({ keepData: String(keep.data), keepDatabase: String(keep.database), confirm: typed });
  return `?${q}`;
}
