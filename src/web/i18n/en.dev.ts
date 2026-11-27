import { msg } from "@/shared/i18n";
import { tDevAudit } from "./en.dev.audit";
import { tDevHealth } from "./en.dev.health";
import { tDevLogs } from "./en.dev.logs";
import { tDevSetup } from "./en.dev.setup";
import { tDevUsers } from "./en.dev.users";
import { tSettings } from "./en.settings";

/** UI strings of the /dev admin area (merged into `id.dev`). The menu label is "Administrasi". */
export const tDev = msg("dev", {
  errorCodes: {
    protected: "Akun ini dilindungi dan tidak bisa diubah atau dihapus dari panel.",
    self: "Untuk sesimu sendiri, pakai halaman Profil.",
    not_found: "Data ini sudah tidak ada, mungkin baru dihapus. Muat ulang halaman untuk melihat daftar terbaru.",
  },
  health: tDevHealth,
  setup: tDevSetup,
  users: tDevUsers,
  audit: tDevAudit,
  logs: tDevLogs,
  /** Same object as `id.settings` once id.ts exposes it; kept here so /dev pages keep `id.dev.settings`. */
  settings: tSettings,
} as const);
