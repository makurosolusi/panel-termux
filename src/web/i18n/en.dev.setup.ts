import type { SetupItemKey, SetupLevel } from "@/shared/dev.types";
import { msg } from "@/shared/i18n";

type SetupItemCopy = { title: string; body: string; action: string };

/** UI strings of the onboarding card and banner (PLAN/05 §5.1, F1). */
export const tDevSetup = msg("dev.setup", {
  title: "Set up Panel Termux",
  description: "Required and recommended steps to keep the panel safe and your data recoverable.",
  progress: (n: number, total: number) => `${n} of ${total} done`,
  hide: "Hide the guide",
  reopen: "Setup guide",
  hidden: "Guide hidden. Open it again with the Setup guide button.",
  shown: "Setup guide shown.",
  levels: { required: "Required", recommended: "Recommended", optional: "Optional" } satisfies Record<
    SetupLevel,
    string
  >,
  done: "Done",
  markUndone: "Mark as not done",
  manual: "ticked by hand",
  markedDone: "Step marked as done.",
  markedUndone: "Step marked as not done.",
  banner: {
    title: (n: number, total: number) => `Set up Panel Termux: ${n} of ${total} done`,
    continue: "Continue",
  },
  items: {
    access: {
      title: "Protect the panel with Cloudflare Access",
      body: "Sign-in is open to every Google account. Access makes sure only the emails you allow reach the panel's pages and API.",
      action: "See the Access recipe",
    },
    secret_saved: {
      title: "Save a copy of the data key",
      body: "`data/secret` is not included in backups. Without this file, the tokens and keys stored in backups can't be read.",
      action: "Download the data key",
    },
    backup: {
      title: "Set up backups to R2 or S3",
      body: "A daily backup is sent off the phone. Done once the first backup succeeds.",
      action: "Set up backups",
    },
    cloudflare_token: {
      title: "Add a Cloudflare API token",
      body: "So the domain of a new site gets its DNS record right away.",
      action: "Add the token",
    },
    apps_json: {
      title: "Connect `apps.json` to pm2",
      body: "So the sites the panel creates keep running after the phone restarts.",
      action: "Fix in Sites",
    },
    first_site: {
      title: "Create or adopt your first site",
      body: "Connect a domain to your app.",
      action: "Create a site",
    },
    admins: {
      title: "Add a second Admin",
      body: "Optional. An Admin has full control of this phone. If the panel uses Access, add their email to the Access policy too.",
      action: "Open Users",
    },
  } satisfies Record<Exclude<SetupItemKey, "adopt_sites">, SetupItemCopy>,
  accessDone: "I've set it up",
  secretDone: "I've saved it",
  secretCopyHint: "Technical users can also copy it from a laptop:",
  backupFirstRun: "Run the first backup",
} as const);
