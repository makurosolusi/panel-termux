import { formatBytes } from "@/shared/format.number";
import { msg } from "@/shared/i18n";
import type { JobKind, JobNextAction, JobParams, JobStepKey, JobStepStatus } from "@/shared/job.types";

/** Formats an outcome sentence from its coded params. */
type Outcome = (p: JobParams) => string;

/** Param as display text; missing → "–". */
const s = (v: JobParams[string] | undefined): string => (v === undefined || v === null ? "–" : String(v));
/** Byte param as "89.2 MB". */
const b = (v: JobParams[string] | undefined): string => (typeof v === "number" ? formatBytes(v, "en") : s(v));
const runtime = (v: JobParams[string] | undefined): string =>
  v === "native" ? "Android native" : v === "grun" ? "glibc (through grun)" : s(v);
/** `health_timeout.last`: "refused", "no_answer" or an HTTP status. */
const lastAnswer = (v: JobParams[string] | undefined): string =>
  v === "refused" ? "the port refused the connection" : v === "no_answer" ? "no answer" : `last HTTP ${s(v)}`;

/** UI copy of change progress: kinds, step labels, coded outcomes, follow-up actions, recover modes (PLAN/03 §5.8). */
export const tJob = msg("job", {
  title: "Change progress",
  listTitle: "Change history",
  listDescription: "Every site change the panel ran, newest first.",
  kinds: {
    "site.create": "Create site",
    "site.delete": "Delete site",
    "hostname.add": "Add domain",
    "hostname.remove": "Remove domain",
    "site.deploy": "Deploy",
    "site.rollback": "Rollback",
    "site.restart": "Restart site",
    "site.env": "Change environment variables",
    "job.cleanup": "Recover interrupted change",
  } satisfies Record<JobKind, string>,
  steps: {
    validate: "Checking the request",
    inspect: "Checking the current state",
    folder: "Creating the site folder",
    database: "Creating the database",
    env_write: "Writing environment variables",
    ingress: "Changing the cloudflared routes",
    dns: "Setting up DNS",
    tunnel_restart: "Restarting cloudflared",
    domain_probe: "Trying the domain",
    apps_remove: "Removing the apps.json entry",
    app_remove: "Removing the pm2 app",
    database_drop: "Deleting the database",
    folder_remove: "Deleting the site folder",
    stage: "Preparing the binary",
    detect: "Detecting the runtime",
    chmod: "Making it executable",
    swap: "Swapping the binary",
    run_script: "Writing the run script",
    apps_entry: "Registering the app in pm2",
    app_restart: "Restarting the app",
    health: "Health check",
  } satisfies Record<JobStepKey, string>,
  stepStatuses: {
    pending: "waiting",
    running: "running",
    done: "done",
    failed: "failed",
    rolled_back: "rolled back",
    skipped: "skipped",
    interrupted: "interrupted",
  } satisfies Record<JobStepStatus | "interrupted", string>,
  outcomes: {
    validated: () => "The request is valid.",
    invalid_site: (p) => `The request is invalid: ${s(p.issues)}.`,
    busy_backup: () => "A backup is running. Wait until it finishes, then try again.",
    inspect_found: (p) => `Found ${s(p.count)} ${p.count === 1 ? "thing" : "things"} to tidy up.`,
    inspect_nothing: () => "Nothing needs cleaning up.",
    folder_created: (p) => `Folder ${s(p.path)} created.`,
    folder_failed: () => "The site folder could not be created or deleted. See the technical details.",
    database_created: (p) => `Database ${s(p.name)} created.`,
    database_skipped: () => "This site has no database.",
    database_failed: () =>
      "The database command failed, usually because the postgres service is not running. Start postgres, then try again.",
    env_written: (p) => `${s(p.count)} environment ${p.count === 1 ? "variable" : "variables"} written.`,
    env_updated: (p) => `${s(p.set)} set, ${s(p.unset)} removed.`,
    env_restored: () => "The previous environment variable values were restored.",
    env_failed: () => "The .env file could not be written. See the technical details.",
    ingress_added: (p) => `Route added for ${s(p.hostnames)}.`,
    ingress_removed: (p) => `Route removed for ${s(p.hostnames)}.`,
    ingress_unchanged: () => "The cloudflared routes are already correct.",
    ingress_rejected: () => "cloudflared rejected the new configuration. The old configuration is back in use.",
    ingress_config_missing: (p) => `The cloudflared configuration file ${s(p.path)} was not found.`,
    ingress_unsupported: () => "The cloudflared config.yml format cannot be changed automatically.",
    dns_created: (p) => `DNS records created for ${s(p.hostnames)}.`,
    dns_owned_present: () => "The panel's DNS record already exists.",
    dns_same_tunnel: (p) => `The DNS records for ${s(p.hostnames)} already point to this tunnel.`,
    dns_deleted: (p) => `DNS records for ${s(p.hostnames)} deleted.`,
    dns_left: (p) =>
      `The DNS records for ${s(p.hostnames)} could not be deleted and were left in place. Delete them in the Cloudflare dashboard if they are not used.`,
    dns_no_token: () =>
      "No Cloudflare API token is set and this phone is not logged in to Cloudflare, so create the DNS record in the Cloudflare dashboard. The record is below.",
    dns_routed: (p) =>
      `DNS records for ${s(p.hostnames)} created through cloudflared. The panel can only delete them once an API token is set.`,
    dns_route_failed: (p) =>
      `cloudflared could not create the DNS record for ${s(p.hostname)}, possibly because another record with that name already exists. Create or change the record below in the Cloudflare dashboard.`,
    dns_wrong_zone: (p) =>
      `cloudflared created the record in another zone (${s(p.fqdn)}). Delete that record in the Cloudflare dashboard, then add the record below by hand.`,
    dns_none_owned: () => "There are no DNS records owned by the panel.",
    dns_conflict: (p) =>
      `A DNS record for ${s(p.hostname)} already exists that the panel did not create. Delete or change it in the Cloudflare dashboard, then try again.`,
    dns_zone_missing: (p) => `This Cloudflare account has no DNS zone for ${s(p.hostname)}.`,
    dns_api_failed: () => "The Cloudflare API did not answer correctly. Try again in a few moments.",
    dns_no_tunnel_id: () => "The tunnel ID cannot be read from the cloudflared configuration.",
    tunnel_restarted: (p) => `cloudflared restarted (${s(p.seconds)} s).`,
    tunnel_unchanged: () => "cloudflared does not need a restart.",
    tunnel_not_running: (p) => `cloudflared is not running after ${s(p.seconds)} s. Check the cloudflared service log.`,
    tunnel_service_missing: () => "The cloudflared service is not installed in runit.",
    domain_reachable: (p) => `${s(p.hostname)} answers HTTP ${s(p.status)}.`,
    domain_not_yet: (p) => `${s(p.hostname)} does not answer yet (${s(p.status)}). DNS can take a few minutes.`,
    apps_removed: (p) => `Entry ${s(p.name)} removed from apps.json.`,
    apps_absent: () => "There is no entry in apps.json.",
    apps_adopted_skip: () => "Adopted site: its pm2 entry is written by hand and was not changed.",
    apps_json_invalid: () =>
      "The apps.json file is broken. Press Fix on the Setup card (Sites page) so the panel rebuilds it, then try again.",
    app_removed: (p) => `App ${s(p.name)} removed from pm2.`,
    app_not_deployed: () => "The app has never been deployed.",
    app_adopted_skip: () => "Adopted site: the pm2 app was left alone.",
    pm2_failed: () => "The pm2 command failed. See the technical details.",
    pm2_not_running: () => "The pm2 service is not running, so every site has stopped too. Start pm2, then try again.",
    database_dropped: (p) => `Database ${s(p.name)} deleted.`,
    database_kept: () => "Database kept.",
    database_none: () => "This site has no database.",
    database_adopted_skip: () => "Adopted site: the database was left alone.",
    folder_removed: (p) => `Folder ${s(p.path)} deleted.`,
    folder_kept: () => "Site folder kept.",
    folder_gone: () => "The site folder is already gone.",
    folder_adopted_skip: () => "Adopted site: the folder was left alone.",
    folder_not_empty: (p) =>
      `Folder ${s(p.path)} was left in place because it holds other files. Delete it yourself if it is not used.`,
    staged: (p) => `Binary ready (${b(p.sizeBytes)}).`,
    upload_missing: () => "The uploaded file is no longer on the server. Upload the binary again.",
    size_mismatch: (p) => `The file is ${b(p.got)}, but it should be ${b(p.expected)}. Upload it again.`,
    sha_mismatch: () => "The file checksum does not match. Upload the binary again.",
    folder_missing: (p) => `The site folder ${s(p.path)} does not exist.`,
    restart_no_folder: (p) =>
      `The site folder ${s(p.path)} no longer exists, so the app cannot run. Open the site details: delete the site and create it again, or restore it from a backup.`,
    disk_full: () => "The phone's storage is full. Free up space, then try again.",
    runtime_native: () => "Android native binary.",
    runtime_grun: () => "glibc binary, run through grun.",
    invalid_binary: () => "This file is not a runnable Linux arm64 binary.",
    runtime_mismatch: (p) => `This binary is for ${runtime(p.got)}, but pm2 runs this site as ${runtime(p.expected)}.`,
    chmod_done: () => "Made executable.",
    chmod_failed: () => "The file could not be made executable. See the technical details.",
    swap_first: () => "First binary installed.",
    swap_kept_previous: (p) =>
      p.linked === false ? "The old version was copied as a backup." : "The old version was kept.",
    swap_back: () => "The old binary is installed again.",
    swap_nothing_live: () =>
      "No binary has ever run, so there is nothing to put back. The leftover upload was cleaned up.",
    swap_failed: () => "The binary could not be swapped. See the technical details.",
    run_written: (p) => `Run script written (${runtime(p.runtime)}).`,
    run_unchanged: () => "The run script is already correct.",
    run_failed: () => "The run script could not be written.",
    apps_registered: () => "App registered in apps.json.",
    apps_unchanged: () => "The apps.json entry is already correct.",
    apps_migrated: () => "The old apps.json entry was updated to use the run script.",
    integration_not_ready: () => "pm2 is not ready to run sites created by the panel. Finish setup on the Sites page.",
    app_restarted: (p) => `App ${s(p.name)} restarted.`,
    app_started: (p) => `App ${s(p.name)} started.`,
    app_missing: (p) => `App ${s(p.name)} is not in pm2.`,
    app_not_loaded: (p) => `pm2 did not load the app ${s(p.name)} from ecosystem.config.js.`,
    app_not_in_ecosystem: (p) =>
      `The entry for the app ${s(p.name)} is no longer in ecosystem.config.js, so the panel cannot start it. Add the entry back to that file, or delete this site from the panel.`,
    healthy: (p) => `HTTP ${s(p.status)} from \`${s(p.path)}\` in ${s(p.ms)} ms, stable.`,
    health_timeout: (p) =>
      `The app is not healthy after ${s(p.seconds)} s (${lastAnswer(p.last)}). Check the app log below.`,
    app_errored: (p) => `pm2 reports that the app ${s(p.name)} has errored. Check the app log below.`,
    app_unstable: (p) =>
      `The app answered, then pm2 restarted it ${s(p.restarts)}×. This usually means it crashes on start.`,
    app_no_pid: () => "pm2 reports the app as running, but it has no process. Usually the binary cannot be executed.",
    unexpected: () => "Something unexpected went wrong. See the technical details.",
    interrupted: () => "Stopped at this step because the panel restarted.",
  } satisfies Record<string, Outcome>,
  /** Shown when a server code has no copy yet (newer server): the raw code stays visible for support. */
  unknownOutcome: (code: string) => `Result: ${code}`,
  final: {
    succeeded: "Change complete.",
    rolled_back: "The change failed and was rolled back. All safe; nothing needs cleaning up.",
    failed: "The change failed and needs attention.",
    interrupted: "The change was interrupted because the panel restarted. Check it and recover.",
    resolved: "Recovered.",
  },
  next: {
    recover: "Recover",
    rollback: "Restore previous version",
    app_log: "View app log",
    open_site: "Open site details",
    first_deploy: "Upload the first binary",
    redeploy: "Deploy again",
  } satisfies Record<JobNextAction, string>,
  recover: {
    cleanup: "Recover",
    retryDelete: "Retry site deletion",
    retryHostname: "Retry domain removal",
    retryTitle: (target: string) => `Retry removing ${target}?`,
    retryBody:
      "Steps that already finished are skipped; the rest run again from this change's record. Whatever was already deleted cannot be brought back.",
    started: "Recovery started.",
    cleans: "Recovering what was left by",
    cleansLink: "the interrupted change",
  },
  allSites: "Go to the site list",
  whyFailed: "Why it failed",
  appLog: "App log (stderr, last 50 lines)",
  appLogEmpty: "The app log is empty.",
  appLogMissing: "The app log is not available.",
  technical: "Technical details",
  details: "Details",
  stepLog: "Step log",
  copy: "Copy details",
  liveStep: (n: number, total: number, label: string, state: string) => `Step ${n} of ${total}: ${label}… ${state}`,
  progress: (pct: number) => `${pct}%`,
  /** Duration shorter than one second. */
  underSecond: "< 1 s",
  blip: "The panel dropped briefly because cloudflared restarted. This page continues on its own.",
  lostTitle: "Progress cannot be loaded",
  lostBody:
    "The panel has not answered for more than 2 minutes. Check your connection and the server phone, then try again.",
  meta: {
    started: "Started",
    by: (name: string) => `by ${name}`,
    duration: (d: string) => `took ${d}`,
  },
  list: {
    empty: "No changes yet. Creating, changing or deploying a site is recorded here.",
    emptyFiltered: "No changes match the filter.",
    clearFilters: "Clear filters",
    columns: { change: "Change", status: "Status", actor: "By", started: "Started", duration: "Duration" },
    filterKind: "Kind",
    filterStatus: "Status",
    allKinds: "All kinds",
    allStatuses: "All statuses",
    forTarget: (target: string) => `Change history · ${target}`,
    system: "System",
    label: "Change list",
  },
  errorCodes: {
    not_recoverable: "This change no longer needs or allows recovery.",
    already_resolved: "Another admin already recovered this change. Reload the page.",
    invalid_pagination: "The requested page is invalid.",
  },
} as const);
