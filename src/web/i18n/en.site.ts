import { msg } from "@/shared/i18n";
import type {
  AdoptCandidateApp,
  JobKind,
  JobParams,
  JobStepKey,
  SiteIssueCode,
  SiteNoteCode,
} from "@/shared/site.types";
import { tSiteSetup } from "./en.site.setup";

/** Copy that may interpolate server params (`{hostname}`, `{port}` …). */
type Copy = string | ((p: JobParams) => string);
const s = (v: JobParams[string] | undefined) => String(v ?? "");

/** UI strings of the Sites pages: list, setup, adopt, wizard and the running-change banner. */
export const tSite = msg("site", {
  errorCodes: {
    busy: "Another change is running. Wait until it finishes, then try again.",
    not_found: "This site no longer exists; it may have just been deleted. Open the site list to see the ones left.",
    integration_required: "pm2 isn't ready to run sites created by the panel. Finish setup on the Sites page.",
    pm2_unavailable: "The pm2 service isn't running, so every site has stopped too. Start pm2, then try again.",
    pm2_not_running: "The pm2 service isn't running, so every site has stopped too. Start pm2, then try again.",
    no_free_port: "Every port in the site range is taken. Enter another port by hand.",
    app_not_found: "This pm2 app no longer exists. Reload the list, then pick again.",
    app_in_use: "Another site already uses this pm2 app. Pick a different app.",
    self_hostname: "This domain is Panel Termux's own address, so it can't be adopted.",
    adopt_blocked: "The panel can't manage this app. See the reason in the app list.",
    exists: "Another site already uses this name, domain or port. Rename the site, then try again.",
    invalid_name: "Invalid site name. Use lowercase letters, digits and hyphens, starting with a letter.",
    name_reserved: "The panel uses this name. Pick another one.",
    invalid_site: "Some site fields are invalid. Check the marked fields, then try again.",
    invalid_env: "An environment variable is invalid. Check its name, then try again.",
  },
  list: {
    title: "Sites",
    missingFromPm2: "Not running in pm2",
    description: "Domains that cloudflared routes to pm2 apps on this phone.",
    label: "Site list",
    create: "Create site",
    createBlocked: "Finish the pm2 setup first.",
    jobs: "Change history",
    empty: "No sites yet",
    emptyBody: "Create your first site to connect a domain to a Bun app on this phone.",
    cols: { name: "Name", status: "Status", domain: "Main domain", deploy: "Last deploy", port: "Port" },
    adopted: "Adopted",
    more: (n: number) => `+${n}`,
    neverDeployed: "Never",
    port: (p: number) => `port ${p}`,
    actions: (name: string) => `Actions for ${name}`,
    open: "Open",
    openHost: (host: string) => `Open ${host} in a new tab`,
    deploy: "Deploy",
    restart: "Restart",
    restartTitle: (name: string) => `Restart the ${name} app?`,
    restartBody: "This site can't be opened for a few seconds while its app restarts. Other sites aren't affected.",
    appLog: "App log",
    running: (kind: string, target: string) => `Change in progress: ${kind} · ${target}.`,
    interrupted: (kind: string, target: string) =>
      `Change interrupted: ${kind} · ${target}. Recover it so nothing is left half done.`,
    viewJob: "View",
  },
  setup: tSiteSetup,
  discovered: {
    title: "Not managed yet",
    description: "Domains in the cloudflared config that aren't recorded as sites. Adopt them to manage them here.",
    label: "Domains not managed yet",
    cols: { hostname: "Domain", target: "Points to" },
    self: "Panel Termux (this domain)",
    noPort: "unknown port",
    noApp: "no matching pm2 app yet",
    wildcard: "Wildcard domains can't be adopted.",
    adopt: "Adopt",
    adoptLabel: (host: string) => `Adopt ${host}`,
    unavailable: "The pm2 app list can't be read, so domains not managed yet aren't shown.",
    noCandidates: "No matching pm2 app. Make sure the app runs from a folder in ~/sites.",
  },
  adopt: {
    title: (host: string) => `Adopt ${host}`,
    description: "The panel only records this site. Its files, pm2 app and domain stay unchanged until you deploy.",
    app: "pm2 app",
    appPlaceholder: "Pick an app",
    name: "Site name",
    nameHint: "Lowercase letters, digits and hyphens. Usually the same as the app name.",
    folder: "Folder",
    runtime: "Runtime",
    port: "Port",
    runtimes: { native: "Android native", grun: "glibc" },
    scriptRuntimes: {
      native: "runs directly",
      grun: "runs through grun",
      other: "unrecognized launch method",
    },
    portSources: { pm2_env: "from the pm2 env", pm2_args: "from the pm2 arguments", dotenv: "from `.env`" },
    unknown: "unknown",
    submit: "Adopt",
    cancel: "Cancel",
    done: (name: string) => `Site ${name} adopted.`,
    blockers: {
      outside_sites_dir: "This app runs from a folder outside ~/sites, so the panel can't manage it.",
      no_binary: "This app's folder has no `app` file.",
      invalid_binary: "The `app` file in this folder isn't a runnable binary.",
      pm2_module: "This is a pm2 module, not an app.",
      name_invalid: "This app's name can't be used as a site name.",
    } satisfies Record<AdoptCandidateApp["blockers"][number], string>,
    warnings: {
      runtime_script_mismatch:
        "The binary's runtime doesn't match how pm2 runs it. Check ecosystem.config.js before you deploy.",
      script_other:
        "The panel doesn't know how pm2 runs this binary. The health check after a deploy will show the result.",
      port_unknown:
        "No app port found in the pm2 env, arguments or `.env`. The panel uses the port from the cloudflared config.",
      port_mismatch: "The app's port differs from this domain's port in the cloudflared config.",
    } satisfies Record<AdoptCandidateApp["warnings"][number], string>,
  },
  wizard: {
    title: "Create a new site",
    description: "A new site gets a folder, a port and a domain. You upload the binary after the site is created.",
    back: "Back",
    next: "Next",
    create: "Create site",
    cancel: "Cancel",
    steps: ["Address", "Options", "Summary"],
    stepsLabel: "Wizard steps",
    stepOf: (n: number, total: number, label: string) => `Step ${n} of ${total}: ${label}`,
    name: "Site name",
    nameHint: "Lowercase letters, digits and hyphens. Used as the folder name and the app name.",
    hostname: "Domain",
    hostnameExtra: (n: number) => `Extra domain ${n}`,
    hostnamePlaceholder: "e.g. blog.example.com",
    addHostname: "Add another domain",
    removeHostname: (host: string) => `Remove ${host || "empty domain"}`,
    port: "Port",
    portHint: "Filled in with a free port. You can change it.",
    portInvalid: "Enter a port from 1 to 65535.",
    checking: "Checking…",
    available: "The name, domain and port are available.",
    recover: "Recover",
    database: "Create a PostgreSQL database",
    databaseHint: "Creates a new database and role just for this site. DATABASE_URL is written to .env for you.",
    env: "Extra environment variables",
    envHint: "Saved in the site's .env. The panel fills in PORT and DATABASE_URL.",
    summary: "What will happen",
    blip: (hosts: string[]) =>
      `cloudflared restarts once. Every domain on this phone drops for 3–10 s${hosts.length ? `, including ${hosts.join(", ")}` : ""}.`,
    after: "When it is done, upload the first binary from the site page to run it.",
    plan: {
      validate: "Recheck the name, domain and port",
      folder: (p) => `Create the folder ~/sites/${s(p.name)}`,
      database: (p) => (p.database ? `Create the ${s(p.name)} database and its role` : "No database"),
      env_write: (p) =>
        `Write .env (PORT${p.database ? " and DATABASE_URL" : ""}${Number(p.env) > 0 ? ` + ${s(p.env)} variables` : ""})`,
      ingress: (p) => `Add a route for ${s(p.hosts)}${p.port ? ` to port ${s(p.port)}` : ""} in the cloudflared config`,
      dns: (p) =>
        p.dns === "token"
          ? `Create the DNS records for ${s(p.hosts)} in Cloudflare`
          : p.dns === "cert"
            ? `Create the DNS records for ${s(p.hosts)} through this phone's cloudflared login; domains outside that login's zone get a copy-ready record`
            : p.dns === "manual"
              ? `The DNS records for ${s(p.hosts)} aren't created automatically: the panel shows copy-ready records after the site is created`
              : `Create the DNS records for ${s(p.hosts)} through the cloudflared login if there is one; otherwise the panel shows copy-ready records`,
      tunnel_restart: "Restart cloudflared",
      domain_probe: "Check that the domain is reachable",
    } satisfies Partial<Record<JobStepKey, Copy>>,
  },
  issues: {
    name_invalid: "Use 2–31 lowercase letters, digits or hyphens, starting with a letter.",
    name_taken: "Another site or pm2 app already uses this name.",
    name_reserved: "The panel uses this name. Pick another one.",
    name_folder_exists: "A folder with this name already exists in ~/sites. Pick another name, or adopt the app.",
    name_database_exists: (p) =>
      `The ${s(p.name)} database already exists. Pick another name, or turn off the database option.`,
    name_leftover:
      "An earlier attempt to create a site with this name was interrupted. Recover it first, then try again.",
    hostname_invalid: "Enter the full domain in lowercase, e.g. blog.example.com.",
    hostname_in_use: (p) => `${s(p.hostname)} already points to another app in the cloudflared config.`,
    hostname_self: "This is Panel Termux's own address.",
    hostname_duplicate: "This domain is already on another line.",
    hostname_zone_missing: (p) =>
      `This token's account has no Cloudflare zone for ${s(p.hostname)}. Add the domain to Cloudflare first.`,
    hostname_dns_conflict: (p) =>
      `A DNS record for ${s(p.hostname)} already exists that the panel didn't create. Delete or change it in the Cloudflare dashboard, then try again.`,
    port_invalid: "Enter a port from 1 to 65535.",
    port_out_of_range: (p) => `Use a port in the site range ${s(p.from)}–${s(p.to)}.`,
    port_in_use: (p) => `Another app already uses port ${s(p.port)}.`,
    port_panel: "This is Panel Termux's own port.",
  } satisfies Record<SiteIssueCode, Copy>,
  notes: {
    dns_same_tunnel: "The DNS record already points to this phone's tunnel, so it is used as is.",
    dns_owned: "The panel created this DNS record earlier and will reuse it.",
    dns_token_missing:
      "No Cloudflare token is set, so the panel doesn't create this domain's DNS record. Create it by hand in the Cloudflare dashboard.",
    dns_check_failed:
      "DNS can't be checked right now. You can still create the site; the panel tries again when it creates the record.",
  } satisfies Record<SiteNoteCode, Copy>,
  // Change kind names for the running-change banner on /panel/sites (the change pages read tJob).
  job: {
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
  },
} as const);
