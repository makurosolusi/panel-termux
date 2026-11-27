import { msg } from "@/shared/i18n";
import type { Role } from "@/shared/roles";

/** English strings for the app name, role labels and the account menu (tiny: shared by entry and shell). */
export const tApp = msg("app", {
  appName: "Panel Termux",
  roles: { user: "User", admin: "Admin", super_admin: "Super Admin" } satisfies Record<Role, string>,
  menu: {
    signOut: "Sign out",
    signOutFailed: "Could not sign out. Check your internet connection, then try again.",
  },
  /** Toast when the Indonesian pack failed to load at boot; only ever shown in English. */
  languagePackFailed: "Indonesian could not be loaded, so the panel is shown in English. Reload the page to try again.",
} as const);
