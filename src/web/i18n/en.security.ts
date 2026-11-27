import { msg } from "@/shared/i18n";
import type { DataKeyResetInput } from "@/shared/security.types";

/** UI strings of the security cards on Administration → System health (PLAN/04 §5.2–5.3). */
export const tSecurity = msg("security", {
  errorCodes: {
    reauth_required: "This action needs you to sign in again (your session is older than 15 minutes).",
    key_mismatch: "The data key doesn't match, so it can't be downloaded. Fix the key first.",
    key_ok: "Every secret setting can be read, so there is nothing to delete. Reload the page.",
    confirm_mismatch: "The typed word doesn't match. Type delete exactly.",
  },
  dataKey: {
    title: "Data key",
    help: "The data key (data/secret) locks the secret settings and sessions. Without this file, the secret settings in the panel's backups can't be read. Keep a copy off the phone.",
    state: "Status",
    ok: "Matches",
    mismatch: "Doesn't match",
    mismatchBody:
      "The settings below were saved with a different data key, usually because the key file was lost or replaced. Secret settings can't be saved until this is fixed.",
    noTelegram: "Telegram notifications aren't sent until the key is fixed, because their token is locked too.",
    createdThisBoot: "The data key file was newly created when the panel last started.",
    restoreFile: "Best option: put the old data key file back, then restart the panel.",
    restoreSteps: [
      "SVDIR=$PREFIX/var/service sv down panel",
      "cp <old-file> ~/panel/data/secret && chmod 600 ~/panel/data/secret",
      "SVDIR=$PREFIX/var/service sv up panel",
    ],
    restoreStepsLabel: "Manual steps (for technical users)",
    orReset: "If the old file is gone, delete the old secret settings and fill them in again in Settings.",
    exportButton: "Download the data key",
    exportTitle: "Download the data key?",
    exportBody:
      "This file unlocks every secret setting of the panel. Once downloaded, move it from Downloads into a password manager, then delete it from Downloads. Don't keep it on this phone or in the backup bucket.",
    exported: "Data key downloaded.",
    exportedAt: "Last downloaded",
    never: "Never",
    resetButton: "Delete old secret settings",
    resetTitle: "Delete the secret settings that can't be read?",
    resetBody: (labels: string[]) =>
      `${labels.join(", ")} will be deleted and you'll have to fill them in again in Settings. This can't be undone. If you still have the old data key file, put that file back instead.`,
    resetDone: "Old secret settings deleted. Fill them in again in Settings.",
    resetWord: "delete" satisfies DataKeyResetInput["confirm"],
  },
  reauth: {
    body: "This action needs you to sign in again (your session is older than 15 minutes).",
    button: "Sign in again",
    freshNote:
      "Signing in again stops a stolen cookie from being used on another device; it doesn't protect against a taken-over Google account. Turn on 2-Step Verification for your Google account.",
  },
  access: {
    title: "Cloudflare Access",
    notHttps: "Not applicable (the panel address isn't https)",
    seen: "Detected",
    notSeen: "Not detected yet. Private paths may be open without Access. Follow step 4 in the README.",
  },
  sessions: {
    revokeUser: "Sign out of all devices",
    revokeUserTitle: (name: string) => `Sign ${name} out of all devices?`,
    revokeUserBody: "They'll have to sign in again. Their role doesn't change.",
    title: "Sessions",
    summary: (s: number, u: number) =>
      `${s} active ${s === 1 ? "session" : "sessions"} from ${u} ${u === 1 ? "user" : "users"}. A session ends at most 30 days after sign-in.`,
    revokeAll: "Sign out every user",
    revokeAllTitle: "Sign out every user?",
    revokeAllBody:
      "Everyone, including you on other devices, will have to sign in again. The session on this device stays.",
    revokedAll: (n: number) => `${n} ${n === 1 ? "session" : "sessions"} ended.`,
  },
  adminTrust:
    "An Admin has full control of this phone. An Admin can deploy programs that run with the same access as the panel, so they can read every file, database, and the data key, and then make themselves Super Admin. The site programs you deploy have that same access too. Give the Admin role only to people you trust as much as the phone's owner.",
} as const);
