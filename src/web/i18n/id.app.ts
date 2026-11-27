import type { Role } from "@/shared/roles";

/** Indonesian strings for the app name, role labels and the account menu (tiny: shared by entry and shell). */
export const idApp = {
  appName: "Panel Termux",
  roles: { user: "Pengguna", admin: "Admin", super_admin: "Super Admin" } satisfies Record<Role, string>,
  menu: {
    signOut: "Keluar",
    signOutFailed: "Tidak bisa keluar. Periksa koneksi internet, lalu coba lagi.",
  },
  languagePackFailed:
    "Bahasa Indonesia tidak bisa dimuat, jadi panel tampil dalam bahasa Inggris. Muat ulang halaman untuk mencoba lagi.",
} as const;
