import type { Role } from "@/shared/roles";

/** All Indonesian UI strings of the SPA, grouped by screen. */
export const id = {
  appName: "Panel Termux",
  nav: { dev: "Dev", panel: "Panel", profile: "Profil", main: "Navigasi utama" },
  roles: { user: "Pengguna", admin: "Admin", super_admin: "Super Admin" } satisfies Record<Role, string>,
  login: {
    title: "Masuk ke Panel Termux",
    subtitle: "Gunakan akun Google yang sudah diundang.",
    google: "Masuk dengan Google",
    redirecting: "Mengalihkan ke Google…",
    errors: {
      not_invited: "Akun Google ini belum diundang. Minta admin mengundang email kamu, lalu coba lagi.",
      generic: "Gagal masuk. Silakan coba lagi.",
      start: "Tidak bisa memulai login Google. Periksa koneksi lalu coba lagi.",
    },
  },
  session: {
    loading: "Memuat sesi…",
    errorTitle: "Tidak bisa terhubung ke server",
    errorBody: "Gagal memuat sesi. Periksa koneksi internet atau status server, lalu coba lagi.",
    retry: "Coba lagi",
  },
  menu: { account: "Menu akun", signOut: "Keluar", signOutFailed: "Gagal keluar. Silakan coba lagi." },
  profile: { title: "Profil", role: "Peran", email: "Email" },
  panel: { title: "Panel", subtitle: "Kelola server dan aplikasi." },
  dev: { title: "Dev", subtitle: "Alat pengembang dan pengaturan sistem." },
  empty: "Belum ada isi — fitur menyusul",
} as const;
