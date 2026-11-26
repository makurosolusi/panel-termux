import { idDevAudit } from "./id.dev.audit";
import { idDevHealth } from "./id.dev.health";
import { idDevLogs } from "./id.dev.logs";
import { idDevSetup } from "./id.dev.setup";
import { idDevUsers } from "./id.dev.users";
import { idSettings } from "./id.settings";

/** Indonesian strings of the /dev admin area (merged into `id.dev`). The menu label is "Administrasi". */
export const idDev = {
  title: "Administrasi",
  subtitle: "Kesehatan Panel Termux, pengguna, audit, log, dan pengaturan.",
  sections: {
    label: "Bagian administrasi",
    health: "Kesehatan sistem",
    users: "Pengguna",
    audit: "Audit",
    logs: "Log",
    settings: "Pengaturan",
  },
  common: {
    delete: "Hapus",
    search: "Cari",
    prev: "Sebelumnya",
    next: "Berikutnya",
    pageOf: (page: number, pages: number, total: number) => `Halaman ${page} dari ${pages} · ${total} entri`,
    never: "Belum pernah",
    system: "Sistem",
    deletedUser: "Pengguna terhapus",
    /** Empty state of a filtered list. */
    noResults: "Tidak ada yang cocok. Ubah atau hapus filter untuk melihat semua entri.",
  },
  errorCodes: {
    protected: "Akun ini dilindungi dan tidak bisa diubah atau dihapus dari panel.",
    self: "Untuk sesimu sendiri, pakai halaman Profil.",
    not_found: "Data ini sudah tidak ada, mungkin baru dihapus. Muat ulang halaman untuk melihat daftar terbaru.",
  },
  health: idDevHealth,
  setup: idDevSetup,
  users: idDevUsers,
  audit: idDevAudit,
  logs: idDevLogs,
  /** Same object as `id.settings` once id.ts exposes it; kept here so /dev pages keep `id.dev.settings`. */
  settings: idSettings,
} as const;
