import type { Role } from "@/shared/roles";
import { idBackup } from "./id.backup";
import { idCommon } from "./id.common";
import { idDeploy } from "./id.deploy";
import { idDev } from "./id.dev";
import { idLanding } from "./id.landing";
import { idPanel } from "./id.panel";
import { idShell } from "./id.shell";
import { idSite } from "./id.site";
import { idStatus, idStatusHelp } from "./id.status";

/** All Indonesian UI strings of the SPA, grouped by screen. */
export const id = {
  appName: "Panel Termux",
  nav: { dev: "Administrasi", panel: "Panel", profile: "Profil", main: "Navigasi utama" },
  roles: { user: "Pengguna", admin: "Admin", super_admin: "Super Admin" } satisfies Record<Role, string>,
  login: {
    title: "Masuk ke Panel Termux",
    subtitle: "Gunakan akun Google kamu. Akun baru masuk sebagai Pengguna sampai Super Admin mengubah perannya.",
    google: "Masuk dengan Google",
    redirecting: "Mengalihkan ke Google…",
    errors: {
      generic:
        "Masuk dengan Google tidak berhasil. Coba lagi; bila terus gagal, pastikan kamu memakai akun Google yang benar.",
      start: "Tidak bisa membuka halaman masuk Google. Periksa koneksi internet, lalu coba lagi.",
    },
  },
  session: {
    loading: "Memuat sesi…",
    errorTitle: "Tidak bisa terhubung ke Panel Termux",
    errorBody: "Sesi kamu tidak bisa dimuat. Periksa koneksi internet dan pastikan HP server menyala, lalu coba lagi.",
    retry: "Coba lagi",
    serverTitle: "Panel Termux sedang bermasalah",
    serverBody: "Server menjawab dengan galat. Coba lagi beberapa saat lagi; bila berulang, periksa log panel di HP.",
  },
  menu: {
    account: "Menu akun",
    signOut: "Keluar",
    signOutFailed: "Tidak bisa keluar. Periksa koneksi internet, lalu coba lagi.",
  },
  profile: { title: "Profil", role: "Peran", email: "Email" },
  common: idCommon,
  panel: idPanel,
  site: idSite,
  deploy: idDeploy,
  backup: idBackup,
  dev: idDev,
  landing: idLanding,
  shell: idShell,
  status: idStatus,
  statusHelp: idStatusHelp,
} as const;
