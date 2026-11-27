import { msg } from "@/shared/i18n";
import { tDevAudit } from "./en.dev.audit";
import { tDevHealth } from "./en.dev.health";
import { tDevLogs } from "./en.dev.logs";
import { tDevSetup } from "./en.dev.setup";
import { tDevUsers } from "./en.dev.users";
import { tSettings } from "./en.settings";

/** UI strings of the /dev admin area. The menu label is "Administration". */
export const tDev = msg("dev", {
  errorCodes: {
    protected: "This account is protected and can't be changed or deleted from the panel.",
    self: "To manage your own sessions, use the Profile page.",
    not_found: "This item no longer exists; it may have just been deleted. Reload the page to see the latest list.",
  },
  health: tDevHealth,
  setup: tDevSetup,
  users: tDevUsers,
  audit: tDevAudit,
  logs: tDevLogs,
  /** Same object as `tSettings`; kept here so /dev pages can reach it as `tDev.settings`. */
  settings: tSettings,
} as const);
