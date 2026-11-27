import type { FixBlockReason, FixKey, FixPreview } from "@/shared/fix.types";
import type {
  AdoptCandidateApp,
  Discovered,
  DiscoveredIngress,
  Integration,
  IntegrationCheck,
  SiteAdoptRequest,
} from "@/shared/site.types";
import { idSite } from "@/web/i18n/id.site";
import { renderCopy } from "./site.check";

const d = idSite.discovered;
type CheckCopyEntry = Parameters<typeof renderCopy>[0];
const a = idSite.adopt;

/** One "Belum dikelola" row: where the domain points and whether it can be adopted (and why not). */
export type DiscoveredRow = { hostname: string; target: string; adoptable: boolean; reason: string | null };

/** "port 3005 → makuro-solusi"; the panel's own host reads "Panel Termux (domain ini)". */
export function discoveredRow(i: DiscoveredIngress, apps: readonly AdoptCandidateApp[]): DiscoveredRow {
  if (i.self || i.blockers?.includes("self"))
    return { hostname: i.hostname, target: d.self, adoptable: false, reason: null };
  const port = i.port === null ? d.noPort : idSite.list.port(i.port);
  const match = i.match ?? i.app ?? null;
  const target = `${port} → ${match ?? d.noApp}`;
  if (i.blockers?.includes("wildcard")) return { hostname: i.hostname, target, adoptable: false, reason: d.wildcard };
  const any = apps.some((app) => app.blockers.length === 0);
  // the app this domain points at is the useful reason; "no matching app" only when nothing matched
  const blocker = apps.find((app) => app.name === match)?.blockers[0];
  const reason = blocker ? a.blockers[blocker] : any ? null : d.noCandidates;
  return { hostname: i.hostname, target, adoptable: any, reason };
}

/** Rows of the "Belum dikelola" section: adoptable first, the panel's own host last. */
export function discoveredRows(data: Discovered): DiscoveredRow[] {
  const rank = (r: DiscoveredRow) => (r.adoptable ? 0 : r.target === d.self ? 2 : 1);
  return data.ingress.map((i) => discoveredRow(i, data.apps)).sort((x, y) => rank(x) - rank(y));
}

/** Select option of the adopt dialog; blocked apps stay visible, disabled, with the first reason. */
export type AdoptOption = { name: string; disabled: boolean; reason: string | null };

/** Adopt dialog options: usable apps first (alphabetical), then blocked ones. */
export function adoptOptions(apps: readonly AdoptCandidateApp[]): AdoptOption[] {
  return apps
    .map((app) => {
      const first = app.blockers[0];
      return { name: app.name, disabled: first !== undefined, reason: first ? a.blockers[first] : null };
    })
    .sort((x, y) => Number(x.disabled) - Number(y.disabled) || x.name.localeCompare(y.name));
}

/** Adopt dialog form: chosen pm2 app and site name (text, so inputs stay controlled). */
export type AdoptForm = { app: string; name: string };

/** Preselects the app the ingress port matches (else the one usable app with that port); the name follows the app. */
export function adoptPrefill(i: DiscoveredIngress, apps: readonly AdoptCandidateApp[]): AdoptForm {
  const usable = apps.filter((app) => app.blockers.length === 0);
  const match = i.match ?? i.app ?? null;
  const pick = usable.find((app) => app.name === match) ?? usable.find((app) => i.port !== null && app.port === i.port);
  return { app: pick?.name ?? "", name: pick?.name ?? "" };
}

/** Body of POST /sites/adopt, or null until an unblocked app and a name are chosen. */
export function adoptBody(
  hostname: string,
  form: AdoptForm,
  apps: readonly AdoptCandidateApp[],
): SiteAdoptRequest | null {
  const name = form.name.trim();
  const app = apps.find((x) => x.name === form.app);
  if (!app || app.blockers.length > 0 || name === "") return null;
  return { hostname, app: app.name, name };
}

/** Folder / runtime / port lines of the chosen app, e.g. "glibc · dijalankan lewat grun", "3005 · dari `.env`". */
export function appFacts(app: AdoptCandidateApp): { folder: string; runtime: string; port: string } {
  const runtime = app.runtime ? a.runtimes[app.runtime] : a.unknown;
  const port =
    app.port === null
      ? a.unknown
      : app.portSource
        ? `${app.port} · ${a.portSources[app.portSource]}`
        : String(app.port);
  return { folder: app.cwd ?? a.unknown, runtime: `${runtime} · ${a.scriptRuntimes[app.scriptRuntime]}`, port };
}

/** Non-blocking warnings of the chosen app, in Indonesian. */
export const appWarnings = (app: AdoptCandidateApp): string[] => app.warnings.map((w) => a.warnings[w]);

/** Integration is ready for panel-built sites (`ready`, or no issues on a 0.2.x server). */
export const integrationReady = (i: Integration): boolean => i.ready ?? i.issues.length === 0;

const checksOf = (i: Integration): IntegrationCheck[] => i.checks ?? [];

/** The Persiapan card shows while not ready or while pm2 has a warning (auto-exit, guard). */
export const setupNeeded = (i: Integration): boolean =>
  !integrationReady(i) || checksOf(i).some((c) => c.key.startsWith("pm2_") && c.state !== "ok");

/** Checks that are not ok. */
export const failingChecks = (i: Integration): IntegrationCheck[] => checksOf(i).filter((c) => c.state !== "ok");

/** Text of one check for its state (ok text when a state has no own copy). */
export function checkText(c: IntegrationCheck): string {
  const copy: Partial<Record<IntegrationCheck["state"], CheckCopyEntry>> = idSite.setup.checks[c.key];
  const forState = copy[c.state] ?? copy.ok ?? c.key;
  return renderCopy(forState, c.params);
}

const stateOf = (i: Integration, key: IntegrationCheck["key"]) => checksOf(i).find((c) => c.key === key)?.state;

/** "Cara manual" shows the block steps: the ecosystem does not load panel sites through the current block yet. */
export const snippetNeeded = (i: Integration): boolean =>
  stateOf(i, "ecosystem_spreads_apps_json") !== "ok" || stateOf(i, "snippet_current") !== "ok";

/** The shell command that opens the ecosystem file reported by the server. */
export const editCommand = (i: Integration): string => `nano ${i.ecosystemPath ?? "~/sites/ecosystem.config.js"}`;

const fixFor = (i: Integration, key: IntegrationCheck["key"]) => (i.fixes ?? []).find((f) => f.checks.includes(key));

/**
 * Checklist rows, one problem = one row: a failing check whose fix already belongs to an earlier failing row is folded
 * into it, and "cara lama" is not repeated while panel sites are not loaded at all (servers without `fixes`).
 */
export function visibleChecks(i: Integration): IntegrationCheck[] {
  const notLoaded = (stateOf(i, "ecosystem_spreads_apps_json") ?? "ok") !== "ok";
  const seen = new Set<FixKey>();
  return checksOf(i).filter((c) => {
    if (c.state === "ok") return true;
    if (c.key === "snippet_current" && notLoaded) return false;
    const fix = fixFor(i, c.key);
    if (!fix) return true;
    if (seen.has(fix.key)) return false;
    seen.add(fix.key);
    return true;
  });
}

/** Fix the panel can apply now for a failing row, or null. */
export function rowFix(i: Integration, c: IntegrationCheck): FixKey | null {
  const fix = c.state === "ok" ? undefined : fixFor(i, c.key);
  return fix?.available ? fix.key : null;
}

/** Why the panel cannot fix a failing row itself (copy `setup.unfixable`), or null. */
export function rowBlocked(i: Integration, c: IntegrationCheck): FixBlockReason | null {
  const fix = c.state === "ok" ? undefined : fixFor(i, c.key);
  return fix && !fix.available ? fix.reason : null;
}

/** Fixes behind "Perbaiki semua (n)": one per failing row, in checklist order. */
export const applicableFixes = (i: Integration): FixKey[] => visibleChecks(i).flatMap((c) => rowFix(i, c) ?? []);

/** "Cara manual" opens by itself when a failing row has a fix the panel cannot apply. */
export const manualOpen = (i: Integration): boolean => visibleChecks(i).some((c) => rowBlocked(i, c) !== null);

/** `--no-auto-exit` is in the run script but pm2 has not restarted since (ok + info, no button). */
export const pm2Pending = (i: Integration): boolean =>
  Boolean(checksOf(i).find((c) => c.key === "pm2_auto_exit" && c.state === "ok")?.params.pending);

/** Plain-language lines of one fix preview, for the dialog (readers who never open the diff). */
export function fixSummary(p: FixPreview): string[] {
  const dl = idSite.setup.dialog;
  const e = p.effects;
  if (p.key === "pm2_auto_exit") return [dl.pm2_auto_exit.body];
  if (p.key === "sites_dir_create") return [dl.sites_dir_create.body(e.dir ?? "")];
  return [
    dl.ecosystem_block.body(e.keepApps),
    ...(e.addApps.length ? [dl.ecosystem_block.addApps(e.addApps)] : []),
    ...(e.oldSpread ? [dl.ecosystem_block.oldSpread] : []),
    ...(e.guard ? [dl.ecosystem_block.guard] : []),
  ];
}
