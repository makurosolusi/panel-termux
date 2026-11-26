import { join } from "node:path";
import type { BackupItemKind, BackupManifest } from "../../shared/backup.types";
import type { BackupItemRow } from "../db/schema";

/** Where things live on this phone (absolute); the same names go into the manifest. */
export type BackupPaths = { panelDir: string; dataDir: string; sitesDir: string; cloudflaredDir: string };

/** Order a new phone restores items in (README "Pulihkan ke HP baru"). */
export const RESTORE_ORDER: BackupManifest["restoreOrder"] = [
  "sites",
  "cloudflared",
  "secrets",
  "globals",
  "database",
  "panel",
];

/** What is never in a backup, as manifest text (the UI uses BackupExcluded codes). */
const EXCLUDED_TEXT = [
  "site binaries (app, app.prev, app.new) and node_modules at site level",
  "~/.cloudflared/cert.pem",
];

/** Object name of an item under the run stem. */
export function itemFile(kind: BackupItemKind, name: string): string {
  switch (kind) {
    case "database":
      return `${name}.dump`;
    case "globals":
      return "globals.sql";
    case "panel":
      return "panel.db";
    case "checksums":
      return "SHA256SUMS";
    case "manifest":
      return "manifest.json";
    default:
      return `${kind}.tar.gz`;
  }
}

const base = (key: string) => key.split("/").pop() ?? key;

/** Non-destructive command for a new phone; the downloaded file is in the current directory. */
export function restoreHint(i: Pick<BackupItemRow, "kind" | "name" | "key">, p: BackupPaths): string {
  const file = base(i.key);
  const live = join(p.dataDir, "panel.db");
  switch (i.kind) {
    case "database":
      return `pg_restore -U postgres --create --exit-on-error -d postgres ${file}`;
    case "globals":
      return `psql -U postgres -d postgres -f ${file}`;
    case "sites":
      return `mkdir -p ${p.sitesDir} && tar -xzkf ${file} -C ${p.sitesDir}`;
    case "cloudflared":
      return `mkdir -p ${p.cloudflaredDir} && tar -xzkf ${file} -C ${p.cloudflaredDir}`;
    case "secrets":
      return `mkdir -p secrets && tar -xzf ${file} -C secrets`;
    case "panel":
      return `sv down panel && cp ${file} ${live} && rm -f ${live}-wal ${live}-shm && sv up panel`;
    default:
      return "";
  }
}

/** `tunnel:` and the basename of `credentials-file:` from config.yml text (never the file contents). */
export function parseTunnel(configYml: string | null): BackupManifest["tunnel"] {
  if (!configYml) return null;
  const ref = configYml.match(/^tunnel:\s*(\S+)/m)?.[1];
  const cred = configYml.match(/^credentials-file:\s*(\S+)/m)?.[1];
  return ref ? { ref, credentialsFile: cred ? base(cred) : "" } : null;
}

/** `sha256sum` format: `<hex>  <basename>` per ok item (checksums/manifest themselves excluded). */
export function checksumsText(items: BackupItemRow[]): string {
  return items
    .filter((i) => i.ok && i.sha256 && i.kind !== "checksums" && i.kind !== "manifest")
    .map((i) => `${i.sha256}  ${base(i.key)}\n`)
    .join("");
}

/** Inputs of the manifest that are not items. */
export type ManifestFacts = Omit<BackupManifest, "format" | "items" | "excluded" | "restoreOrder" | "restoreSteps">;

/** Run index uploaded last; holds names and paths only, no secret values (PLAN/04 K5). */
export function buildManifest(facts: ManifestFacts, items: BackupItemRow[]): BackupManifest {
  const ok = items.filter((i) => i.ok && i.kind !== "manifest");
  const file = (k: BackupItemKind) => ok.filter((i) => i.kind === k).map((i) => base(i.key));
  const stem = (ok[0] ? base(ok[0].key) : "").replace(/-.*$/, "-");
  const p = facts.paths;
  const restoreSteps = [
    `sha256sum -c ${stem}SHA256SUMS`,
    ...file("sites").map((f) => `mkdir -p ${p.sitesDir} && tar -xzf ${f} -C ${p.sitesDir}`),
    ...file("cloudflared").map((f) => `mkdir -p ${p.cloudflaredDir} && tar -xzf ${f} -C ${p.cloudflaredDir}`),
    ...file("secrets").map((f) => `mkdir -p secrets && tar -xzf ${f} -C secrets`),
    "install server-termux (postgres, pm2, cloudflared), then reboot",
    ...file("globals").map((f) => `psql -U postgres -d postgres -f ${f}`),
    ...file("database").map((f) => `pg_restore -U postgres --create --exit-on-error -d postgres ${f}`),
    "install the panel; keep the service down until panel.db and .env are in place",
    ...file("panel").map((f) => `cp ${f} ${join(p.dataDir, "panel.db")} && rm -f ${join(p.dataDir, "panel.db")}-wal`),
    `set APP_BASE_URL=${facts.appBaseUrl} in ${join(p.panelDir, ".env")}, then start the panel`,
    ...facts.sites.filter((s) => s.needsBinary).map((s) => `deploy the binary of site ${s.name} again`),
  ];
  return {
    format: 1,
    ...facts,
    items: ok.map((i) => ({
      kind: i.kind,
      name: i.name,
      file: base(i.key),
      sizeBytes: i.sizeBytes ?? 0,
      sha256: i.sha256 ?? "",
    })),
    excluded: facts.includesSecrets ? EXCLUDED_TEXT : [...EXCLUDED_TEXT, "secrets (backup.include_secrets off)"],
    restoreOrder: RESTORE_ORDER,
    restoreSteps,
  };
}
