import type { Role } from "@/shared/roles";
import { idBackup } from "./id.backup";
import { idCommon } from "./id.common";
import { idDeploy } from "./id.deploy";
import { idDev } from "./id.dev";
import { idLanding } from "./id.landing";
import { idPanel } from "./id.panel";
import { idSite } from "./id.site";

/** All Indonesian UI strings of the SPA, grouped by screen. */
export const id = {
  appName: "Panel Termux",
  nav: { dev: "Dev", panel: "Panel", profile: "Profil", main: "Navigasi utama" },
  roles: { user: "Pengguna", admin: "Admin", super_admin: "Super Admin" } satisfies Record<Role, string>,
  login: {
    title: "Masuk ke Panel Termux",
    subtitle: "Masuk dengan akun Google kamu.",
    google: "Masuk dengan Google",
    redirecting: "Mengalihkan ke Google…",
    errors: {
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
  common: idCommon,
  panel: idPanel,
  site: idSite,
  deploy: idDeploy,
  backup: idBackup,
  dev: idDev,
  landing: idLanding,
} as const;
