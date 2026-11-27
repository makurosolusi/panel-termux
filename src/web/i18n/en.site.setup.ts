import type { FixBlockReason, FixErrorCode, FixFile } from "@/shared/fix.types";
import { msg } from "@/shared/i18n";
import { type IntegrationCheckKey, type JobParams, PM2_GUARD_NAME } from "@/shared/site.types";

/** Copy that may interpolate server params (`{path}`, `{count}` …). */
type Copy = string | ((p: JobParams) => string);
type CheckCopy = { ok: Copy; warning?: Copy; error?: Copy };
const s = (v: JobParams[string] | undefined) => String(v ?? "");

/** "blog", "blog and shop", "blog, shop, and api" (the conjunction follows the locale via `tSiteSetup.names.and`). */
export function joinNames(names: readonly string[]): string {
  const and = tSiteSetup.names.and;
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} ${and} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, ${and} ${names.at(-1)}`;
}

/** pm2 app names for people: the panel's guard gets a plain label instead of its internal name (QA fix-07 N4). */
export const appNamesText = (names: readonly string[]): string =>
  joinNames(names.map((n) => (n === PM2_GUARD_NAME ? tSiteSetup.names.guard : n)));

/** UI strings of the Setup card on /panel/sites (PLAN/03 §5.1, PLAN/06 §4.2); part of `tSite.setup`. */
export const tSiteSetup = msg("site.setup", {
  /** Words of `joinNames` / `appNamesText`. */
  names: { and: "and", guard: "pm2 guard" },
  title: "Setup",
  description:
    "One time only: the panel connects the sites it creates to pm2 so they keep running after the phone restarts.",
  checklist: "Check results",
  recheck: "Check again",
  checking: "Checking…",
  checkedAt: (ago: string) => `Checked ${ago}`,
  readyLine: (n: number) =>
    `pm2 is ready: ${n} ${n === 1 ? "app" : "apps"} found, including sites created by the panel.`,
  stillFailing: (n: number) => (n === 1 ? "1 item still needs fixing." : `${n} items still need fixing.`),
  allOk: "Required checks passed. pm2 is ready to run sites created by the panel.",
  tokenLink: "Set the token in Settings",
  adoptTitle: "Sites already running",
  adoptBody: (n: number) =>
    n === 1
      ? "1 domain already points to an app on this phone but is not recorded yet. Adopt it to deploy from the panel."
      : `${n} domains already point to apps on this phone but are not recorded yet. Adopt them to deploy from the panel.`,
  adoptLink: "See domains not managed yet",
  checks: {
    sites_dir: {
      ok: "Sites folder exists",
      error: (p) =>
        `The folder ${s(p.path)} does not exist yet. Press Fix to let the panel create it, or change the sites folder in Settings.`,
    },
    apps_json: {
      ok: "apps.json can be read",
      error: (p) =>
        p.reason === "invalid"
          ? "apps.json is broken (not a JSON list). Press Fix to let the panel rebuild it from the panel's site list."
          : "apps.json does not exist yet. Press Check again and the panel creates it.",
    },
    ecosystem_file: {
      ok: "ecosystem.config.js exists",
      error: (p) =>
        `The file ${s(p.path)} does not exist, so pm2 does not know which apps to run. Press Fix to let the panel create it.`,
    },
    ecosystem_loads: {
      ok: "pm2 can load ecosystem.config.js",
      error:
        "pm2 cannot load ecosystem.config.js. Running sites are fine for now, but no app will start after the phone restarts. Fix the file, then check again.",
    },
    ecosystem_spreads_apps_json: {
      ok: "pm2 also runs the sites created by the panel",
      error: (p) =>
        p.noSites
          ? "Before the first site is created, the panel needs to connect it to pm2."
          : "pm2 does not run the sites created by the panel yet, so they will not come back after the phone restarts.",
    },
    snippet_current: {
      ok: "Panel sites are loaded the current way",
      error: "pm2 loads the panel's sites the old way: if one site is broken, every app can stop.",
    },
    apps_entries_runnable: {
      ok: "Every site in apps.json has a binary",
      warning: (p) => `Sites in apps.json without a binary yet: ${s(p.count)}. pm2 skips them until they are deployed.`,
      error: (p) =>
        `Sites in apps.json without a binary yet: ${s(p.count)}. pm2 loads them the old way, which does not skip them.`,
    },
    pm2_runtime: {
      ok: "The pm2 service is running",
      error: "The pm2 service is not running, so every site has stopped too.",
    },
    pm2_auto_exit: {
      ok: (p) =>
        p.pending
          ? "The pm2 safeguard is installed. It takes effect after the phone or pm2 restarts."
          : "pm2 stays up with no apps",
      warning: "pm2 can exit on its own when every app is stopped.",
    },
    pm2_guard: {
      ok: "pm2 has an app besides the panel's sites",
      warning: "pm2 can exit on its own when the last site is deleted.",
    },
    tunnel: {
      ok: "cloudflared tunnel found",
      error: "No cloudflared tunnel found. Check ~/.cloudflared/config.yml on the phone, then check again.",
    },
    cloudflare_token: {
      ok: "Cloudflare API token is set",
      warning: "No Cloudflare API token set (optional). Without a token, create DNS records for new domains by hand.",
    },
  } satisfies Record<IntegrationCheckKey, CheckCopy>,
  notReady: "pm2 is not ready to run sites created by the panel.",
  notReadyLink: "Finish setup on the Sites page",
  fix: "Fix",
  fixAll: (n: number) => `Fix all (${n})`,
  fixLabel: (what: string) => `Fix: ${what}`,
  dialog: {
    ecosystem_block: {
      title: "Connect the panel's sites to pm2?",
      titleUpdate: "Update how pm2 loads the panel's sites?",
      body: (keep: readonly string[]) =>
        keep.length
          ? `The panel adds one block at the end of \`ecosystem.config.js\`. Existing apps stay the same and are not restarted: ${joinNames(keep)}. Running sites are not affected.`
          : "The panel adds one block at the end of `ecosystem.config.js`. Running sites are not affected.",
      addApps: (apps: readonly string[]) => `The next time pm2 starts, it also runs ${joinNames(apps)}.`,
      keptApps: (apps: readonly string[]) => `pm2 keeps running ${joinNames(apps)}, now through the panel's block.`,
      oldSpread:
        "The old `...require('./apps.json')` line is replaced, because it can stop every app if `apps.json` is broken.",
      guard: "Since there are no other apps yet, the panel also adds a small guard (about 6 MB) to keep pm2 up.",
    },
    pm2_auto_exit: {
      title: "Install the pm2 safeguard?",
      body: "The panel changes the pm2 service settings so pm2 does not exit on its own when every app is stopped. This takes effect the next time pm2 restarts; apps are not affected now.",
    },
    sites_dir_create: {
      title: "Create the sites folder?",
      titleEcosystem: "Create ecosystem.config.js?",
      body: (dir: string, ecosystem: boolean) =>
        ecosystem
          ? `The panel creates the folder \`${dir}\` for your sites, along with \`apps.json\` and the \`ecosystem.config.js\` that pm2 reads.`
          : `The panel creates the folder \`${dir}\` for your sites, along with \`apps.json\`.`,
      ecosystemOnly: (path: string) =>
        `The panel creates \`${path}\`, the file that tells pm2 which apps to run, including the sites created by the panel.`,
      runningSafe: "Running apps are not affected now.",
      stopApps: (apps: readonly string[]) =>
        `Running but not in this new file: ${appNamesText(apps)}. They stop when pm2 restarts and do not start again; for now they keep running. To keep them, add their entries to that file before you restart pm2.`,
    },
    apps_json_rebuild: {
      title: "Rebuild apps.json?",
      body: (apps: readonly string[]) =>
        apps.length
          ? `\`apps.json\` is broken, so the panel rewrites it from the panel's site list: ${joinNames(apps)}.`
          : "`apps.json` is broken, so the panel rewrites it from the panel's site list. No site is ready to run yet, so the list is empty.",
    },
    restartNote:
      "pm2 picks up this change the next time it starts. Afterwards press Restart pm2 now, or Start pm2 if pm2 is not running.",
    backupNote: "A copy of the old file is kept, so you can undo this change.",
    showDiff: "Show the file changes",
    loading: "Preparing the preview…",
    apply: "Apply",
    cancel: "Cancel",
    applying: "Applying…",
  },
  dialogAll: { title: (n: number) => (n === 1 ? "Fix 1 item?" : `Fix ${n} items at once?`) },
  diff: {
    label: (path: string) => `Changes to ${path}`,
    added: "added",
    removed: "removed",
  },
  done: "Fixed. The checks ran again.",
  doneAll: (n: number) => `${n} ${n === 1 ? "item" : "items"} fixed. The checks ran again.`,
  notApplied: "Not applied: pm2 could not load the result. The old file is still in use.",
  more: "Changes by the panel",
  lastFix: {
    ecosystem: (ago: string) => `The panel changed the ecosystem file ${ago}.`,
    pm2_run: (ago: string) => `The panel changed the pm2 run script ${ago}.`,
    apps_json: (ago: string) => `The panel rebuilt apps.json ${ago}.`,
  } satisfies Record<FixFile, (ago: string) => string>,
  lastFixSites: (sites: readonly string[]) => `Sites: ${joinNames(sites)}.`,
  undoAction: "Undo change",
  undoLabel: {
    ecosystem: "Undo the change to the ecosystem file",
    pm2_run: "Undo the change to the pm2 run script",
    apps_json: "Undo the change to apps.json",
  } satisfies Record<FixFile, string>,
  undoTitle: (at: string) => `Restore the file to its version from ${at}?`,
  undoBody: {
    ecosystem: "pm2 no longer runs the sites created by the panel after the phone restarts.",
    ecosystemSites: (sites: readonly string[]) =>
      `After the phone restarts, these sites no longer run: ${joinNames(sites)}. Nothing stops right now.`,
    pm2_run: "pm2 can exit on its own again when every app is stopped.",
    apps_json: "`apps.json` goes back to its old, broken content.",
    appsJsonSites: (sites: readonly string[]) =>
      `\`apps.json\` goes back to its old, broken content, so pm2 does not run ${joinNames(sites)} after the phone restarts. Nothing stops right now.`,
  },
  undoChanged: "The file was changed again after the fix. Restoring the old version discards that change.",
  undoForce: "Restore anyway",
  undone: "Change undone.",
  restartPm2: "Restart pm2 now",
  restartPm2Title: "Restart pm2 now?",
  restartPm2Body: (apps: readonly string[]) =>
    apps.length
      ? `Every app stops for a few seconds and then runs again: ${appNamesText(apps)}. Visitors may be cut off briefly.`
      : "pm2 stops for a few seconds and then runs again.",
  restartPm2Stops: (apps: readonly string[]) =>
    `Running now but not in \`ecosystem.config.js\`, so they stop and do not start again: ${appNamesText(apps)}.`,
  restartTyped: "pm2",
  restartWaiting: "Waiting for the apps to run again…",
  restartPm2FileNote: "The panel's changes to `ecosystem.config.js` take effect now.",
  restartNotFound: "The pm2 service is not registered in this phone's runit, so pm2 was not restarted.",
  restartOk: "pm2 restarted. Every app is running again.",
  restartCheckFailed: (apps: readonly string[]) => `Not running again after pm2 restarted: ${appNamesText(apps)}.`,
  restartNotListed: (apps: readonly string[]) =>
    `Not in \`ecosystem.config.js\`, so pm2 does not run them again: ${appNamesText(apps)}. Add their entries back to that file, then restart pm2.`,
  restartListedHint: "Check the app log to see why it is not running yet.",
  restartAppsLink: "Open Apps",
  restartFailedHint: "Restoring the ecosystem file to its version before the fix usually brings them back.",
  restoreAndRestart: "Restore the ecosystem file and restart pm2",
  restoreAndRestartTitle: "Restore the ecosystem file, then restart pm2?",
  manual: {
    title: "Manual steps (for technical users)",
    step1: "Open the ecosystem file in Termux:",
    step2: "Paste this block at the end of the file:",
    step1Create: "Create a new ecosystem file in Termux:",
    step2Create: "Fill the file with this text:",
    stepRepair: "First fix the error named in the Failed line above (usually a missing bracket or comma).",
    step3: "Save. pm2 does not need a restart.",
    step4: "Press Check again.",
    copyBlock: "Copy block",
    runScript: "Add `--no-auto-exit` after `pm2-runtime` in this file, then restart the pm2 service when it is safe:",
    pm2Start: "Start the pm2 service from Termux:",
  },
  errors: {
    busy: "A site change or backup is running. Try again once it finishes.",
    changed: "The file changed since the preview was made. Review the changes again.",
    changed_during_fix: "The file is being edited on the phone. Close the editor, then try again.",
    changed_since: "The file was changed again after the fix. Restoring the old version discards that change.",
    validation_failed: "Not applied: pm2 could not load the result. The old file is still in use.",
    not_fixable: "The panel cannot fix this automatically. Follow Manual steps on the Setup card.",
    disk_full: "The phone's storage is full, so the file was not changed.",
    not_writable: "The panel has no permission to change this file, so it was not changed.",
    not_found: "The copy of the old file is gone, so the change cannot be undone.",
  } satisfies Record<FixErrorCode, string>,
  unfixable: {
    ecosystem_missing:
      "The file `ecosystem.config.js` does not exist, so the panel does not know how pm2 runs on this phone.",
    ecosystem_unloadable:
      "pm2 cannot load `ecosystem.config.js` right now, so the panel does not change it. Fix the error first, then check again.",
    ecosystem_linked:
      "`ecosystem.config.js` is a link to another file (possibly one that no longer exists), so the panel does not change or overwrite it.",
    not_config_js: "The ecosystem file name must end in `.config.js` for pm2 to read it as an app list.",
    too_large: "The ecosystem file is too large to change automatically.",
    not_utf8:
      "The ecosystem file uses a text encoding other than UTF-8, so the panel does not change it to avoid corrupting it.",
    markers_broken:
      "The panel's block markers in `ecosystem.config.js` are broken or duplicated, so the panel does not change it.",
    unknown_apps_json_use:
      "`ecosystem.config.js` loads `apps.json` in a way the panel does not recognize, so the panel does not change it.",
    run_script_missing: "The pm2 service run script was not found.",
    run_script_unknown: "The pm2 service run script is written in a way the panel does not recognize.",
    sites_dir_outside_home: "The sites folder is outside the Termux home folder, so the panel does not create it.",
  } satisfies Record<FixBlockReason, string>,
  unfixableSuffix: "Follow Manual steps below.",
  unfixableElsewhere: "Follow Manual steps on the Setup card.",
} as const);
