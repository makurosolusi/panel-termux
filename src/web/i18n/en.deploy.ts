import type { DeployKind } from "@/shared/deploy.types";
import { msg } from "@/shared/i18n";
import type { SiteRuntime } from "@/shared/site.types";

/** Why chunk 0 is not a runnable binary (`invalid_binary.reason`). */
type InvalidReason = "not_elf" | "not_64le" | "not_aarch64" | "interp" | "truncated";

/** UI strings of the site #deploy section: upload, resume, rollback and deploy history (PLAN/03 §5.8). */
export const tDeploy = msg("deploy", {
  title: "Deploy",
  adoptedNote:
    "This site was adopted: its pm2 entry is written by hand in ecosystem.config.js. The panel only replaces the binary and restarts the app; the runtime (native/grun) isn't changed.",
  live: {
    title: "Running version",
    none: "No binary yet. Upload the first binary to run this site.",
    untracked: "Untracked version",
    untrackedHelp:
      "This binary was replaced outside the panel (e.g. copied straight to the phone), so it has no deploy record.",
    sha: "Version",
    file: "File name",
    size: "Size",
    runtime: "Runtime",
    modified: "Installed",
  },
  runtimes: { native: "Android native", grun: "glibc through grun" } satisfies Record<SiteRuntime, string>,
  upload: {
    title: "Upload a new binary",
    restartNote: "Once the upload finishes, the app restarts and the site drops for a few seconds.",
    help: "Build with one of these targets:",
    targets: [
      {
        cmd: "bun build --compile --target=bun-linux-arm64-android ./index.ts --outfile app",
        note: "Recommended. Runs directly in Termux (Android native).",
      },
      {
        cmd: "bun build --compile --target=bun-linux-arm64 ./index.ts --outfile app",
        note: "glibc binary. Runs through grun (glibc-runner must be installed).",
      },
    ],
    pick: "Choose a binary file",
    pickSame: "Choose the same file",
    tooLarge: (max: string) => `The file is larger than the ${max} limit. Choose a smaller binary.`,
    empty: "This file is empty (0 bytes). Choose the compiled binary again.",
    hashFailed:
      "The checksum can't be computed because the browser needs an HTTPS connection. Open the panel through its https address, then try again.",
    preparing: "Preparing the upload…",
    hashing: (n: number, total: number) => `Computing the checksum of chunk ${n} of ${total}…`,
    progress: (pct: number, sent: string, total: string) => `${pct}% · ${sent} of ${total}`,
    speed: (perSec: string) => `${perSec}/s`,
    progressLabel: "Upload progress",
    completing: "Finishing the upload…",
    waitingBusy: "Waiting for another change to finish…",
    retrying: (sec: number, n: number, max: number) =>
      `Connection lost. Trying again in ${sec} s (attempt ${n} of ${max})…`,
    paused: "The upload stopped because the connection dropped. The chunks already sent are safe.",
    resumeButton: "Resume upload",
    retry: "Try again",
    cancel: "Cancel upload",
    cancelled: "Upload cancelled.",
    pending: (file: string, size: string, done: number, total: number) =>
      `Unfinished upload: ${file} · ${size} · ${done} of ${total} chunks`,
    expiresAt: (at: string) => `expires ${at}`,
    pendingHelp: "Choose the same file to resume; chunks already sent aren't uploaded again.",
    differentTitle: "This file differs from the previous upload. Start a new upload?",
    differentBody: (oldFile: string) =>
      `The unfinished upload of ${oldFile} is discarded, and this file is uploaded from the start.`,
    differentConfirm: "Start a new upload",
    expired:
      "This upload is no longer on the server (more than 1 hour without a new chunk, or another admin started a new upload). Upload the file again.",
    failed: "The upload didn't succeed.",
  },
  invalidBinary: {
    not_elf: "This file isn't a Linux binary. Choose the output of `bun build --compile`, not an archive or a script.",
    not_64le: "This binary isn't 64-bit. Build it again with an arm64 target below.",
    not_aarch64: "This binary is for another processor (not arm64). Build it again with an arm64 target below.",
    interp: "This binary uses an unrecognized loader. Build it again with one of the targets below.",
    truncated: "This binary is truncated. Build it again, then upload it again.",
  } satisfies Record<InvalidReason, string>,
  runtimeMismatch: (got: string, expected: string) =>
    `This binary is for ${got}, but pm2 runs this site as ${expected}. Build it again with the matching target, then upload it again.`,
  noSpace: (need: string, free: string) =>
    `Not enough storage on the phone: ${need} needed, ${free} free. Free up space, then try again.`,
  /** 409 no_folder / deploy blocker: a database site's folder held its only DATABASE_URL; an adopted one is the owner's. */
  noFolder: {
    database: "This site's folder is gone. Delete the site and create it again, or restore it from a backup.",
    adopted:
      "This site's app folder is gone from the phone. An adopted site wasn't created by the panel, so the panel doesn't create its folder. Restore it from a backup, or delete this site from the panel.",
  },
  errorCodes: {
    too_large: "The file exceeds the server's size limit. Choose a smaller binary.",
    invalid_size: "Invalid file size. Choose the file again.",
    invalid_file_name: "Invalid file name. Rename the file (letters, digits, dots, hyphens), then try again.",
    incomplete: "Part of the file didn't reach the server. Choose the same file to resume.",
    upload_expired:
      "This upload is no longer on the server (more than 1 hour without a new chunk, or another admin started a new upload). Upload the file again.",
    chunk_sha_mismatch: "A chunk was corrupted on the way. Resume the upload to send it again.",
    no_folder:
      "This site's folder is no longer on the phone, so the binary can't be installed. Delete this site, then create it again with the same name.",
    integration_required: "pm2 isn't ready to run sites created by the panel. Finish setup on the Sites page.",
    pm2_not_running:
      "The pm2 service isn't running, so every site has stopped too. Press Start pm2 above, then try again.",
    no_previous: "There is no previous version yet. Rollback is available after the second deploy.",
    no_current: "No binary is running, so there is nothing to restore.",
    invalid_binary: "The previous version's binary can't run on this phone.",
    runtime_mismatch: "The binary's runtime doesn't match how pm2 runs this site.",
    no_space: "Not enough storage on the phone. Free up space, then try again.",
  },
  rollback: {
    button: "Restore previous version",
    title: (site: string) => `Restore ${site} to the previous version?`,
    from: "From",
    to: "To",
    untracked: (size: string, at: string) => `untracked version · ${size} · changed ${at}`,
    carries: "Restored",
    carriesList: ["the app binary", "how it runs (native/grun), for sites created by the panel"],
    notCarried: "Not restored",
    notCarriedList: ["environment variables (.env)", "database contents and structure", "files in data/", "domains"],
    note: "If the new version already changed the database structure, the old version may fail to run. The site drops for a few seconds.",
    none: "There is no previous version yet.",
    started: "Rollback started.",
  },
  history: {
    title: "Deploy history",
    label: "Site deploy history",
    columns: {
      at: "Time",
      kind: "Kind",
      version: "Version",
      size: "Size",
      runtime: "Runtime",
      actor: "By",
      duration: "Duration",
      status: "Status",
    },
    active: "Active",
    view: "View change",
    unknownActor: "deleted user",
    empty: "No deploys yet. Upload the first binary to run this site.",
    kinds: { deploy: "Deploy", rollback: "Rollback" } satisfies Record<DeployKind, string>,
  },
} as const);
