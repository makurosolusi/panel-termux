// Bootstrap checks of `panel doctor` (PLAN/07 §3.1, K5): pure DoctorProbe → DoctorCheck[]. The Persiapan card
// checks (group `situs`) are not here: doctor.command calls the server's integration service and its copy.
import type { DoctorBootstrapKey, DoctorCheck, DoctorState } from "../shared/doctor.types";
import { group, make, REINSTALL } from "./doctor.checks.base";
import { panelChecks, tunnelChecks } from "./doctor.checks.panel";
import { type DoctorProbe, HELD_PACKAGES, type PackageState } from "./doctor.probe";

const MB = 1024 * 1024;
/** Below this the panel cannot unpack a deploy or snapshot panel.db (PLAN/07 §3.1). */
const DISK_ERROR_BYTES = 400 * MB;
const DISK_WARN_BYTES = 1024 * MB;
const PLAY_STORE = "GOOGLE_PLAY_STORE";
const FDROID = "pasang ulang Termux dari F-Droid (panel docs android)";
const FREE_SPACE = "kosongkan penyimpanan HP minimal 1 GB";

const gb = (bytes: number) => `${(bytes / 1024 / MB).toFixed(1).replace(".", ",")} GB`;

function termuxChecks(p: DoctorProbe): DoctorCheck[] {
  const t = group("termux");
  const src = p.termuxEnv.TERMUX_APK_RELEASE;
  const free = p.freeBytes;
  const app = (key: DoctorBootstrapKey, name: string, has: boolean | null) =>
    has === null
      ? make("termux", key, "info", `${name} tidak bisa dicek (cmd package tidak menjawab)`)
      : t(key, has, `${name} terpasang`, [
          "warning",
          `${name} belum terpasang`,
          `pasang ${name} dari F-Droid (panel docs android)`,
        ]);
  const pacman = p.termuxEnv.TERMUX_APP_PACKAGE_MANAGER === "pacman" && p.files.pacman;
  return [
    t("arch_arm64", p.arch === "arm64", "HP 64-bit (arm64)", [
      "error",
      `Arsitektur ${p.arch} tidak didukung, panel butuh HP 64-bit (arm64)`,
      null,
      { arch: p.arch },
    ]),
    t("termux_prefix", p.isTermux, "Berjalan di Termux", ["error", "Folder Termux ($PREFIX) tidak ditemukan", FDROID]),
    src
      ? t("termux_source", src !== PLAY_STORE, "Termux dari F-Droid/GitHub", [
          "error",
          "Termux dari Play Store sudah usang dan tidak didukung",
          FDROID,
        ])
      : make("termux", "termux_source", "info", "Asal Termux tidak diketahui (TERMUX_APK_RELEASE tidak diset)"),
    free === null
      ? make("termux", "disk_free", "info", "Ruang kosong tidak bisa dibaca")
      : t("disk_free", free >= DISK_WARN_BYTES, `Ruang kosong ${gb(free)}`, [
          free < DISK_ERROR_BYTES ? "error" : "warning",
          `Ruang kosong tinggal ${gb(free)}`,
          FREE_SPACE,
        ]),
    t("pkg_manager_apt", p.files.apt, "Pengelola paket apt", [
      "error",
      pacman ? "Termux memakai pacman, panel hanya mendukung apt" : "apt tidak ditemukan di Termux",
      FDROID,
    ]),
    app("app_termux_boot", "Termux:Boot", p.apps.boot),
    app("app_termux_api", "Termux:API", p.apps.api),
  ];
}

function packageChecks(p: DoctorProbe): DoctorCheck[] {
  const k = group("paket");
  const pkg = (key: DoctorBootstrapKey, name: string, has: boolean, state: DoctorState, install = name) =>
    k(key, has, name, [state, `${name} belum terpasang`, `jalankan: pkg install ${install}`]);
  // Broken (half-installed/unpacked): no pkg command, a reinstall could upgrade a held package (C15).
  const dpkg = (key: DoctorBootstrapKey, name: string, s: PackageState, state: DoctorState) =>
    s === "broken"
      ? make("paket", key, state, `${name} terpasang tidak lengkap`, "perbaiki pemasangan paket (panel docs paket)")
      : pkg(key, name, s === "installed", state);
  const out = [
    dpkg("pkg_termux_services", "termux-services", p.packages["termux-services"], "error"),
    dpkg("pkg_cloudflared", "cloudflared", p.packages.cloudflared, "error"),
    pkg("node", "node", p.files.node, "error", "nodejs-lts"),
    k("pm2", p.files.pm2Runtime, "pm2", ["error", "pm2 belum terpasang", "jalankan: npm install -g pm2"]),
    dpkg("pkg_postgresql", "postgresql", p.packages.postgresql, "warning"),
    dpkg("pkg_termux_api", "termux-api", p.packages["termux-api"], "warning"),
  ];
  const installed = HELD_PACKAGES.filter((n) => p.packages[n] === "installed");
  if (installed.length && p.held !== null) {
    const loose = installed.filter((n) => !p.held?.includes(n)).join(" dan ");
    out.push(
      k("pkg_held", !loose, `${installed.join(" dan ")} ditahan dari upgrade otomatis`, [
        "warning",
        `${loose} tidak ditahan (apt-mark hold)`,
        "pkg upgrade bisa mematikan tunnel atau database (panel docs paket)",
        { packages: loose },
      ]),
    );
  }
  const { pgDataMajor: data, pgBinMajor: bin } = p;
  if (data && bin)
    out.push(
      k("postgres_major", data === bin, `Versi PostgreSQL cocok dengan data (${bin})`, [
        "error",
        `Data PostgreSQL versi ${data}, program versi ${bin}: database tidak bisa jalan`,
        "pulihkan dengan dump/restore (panel docs paket)",
        { data, program: bin },
      ]),
    );
  return out;
}

/** State and next step when a runit service is down (pm2/postgres have a start button in the UI). */
const SVC_DOWN: Record<keyof DoctorProbe["services"], [DoctorState, string]> = {
  panel: ["error", "jalankan: sv up panel"],
  pm2: ["error", "buka halaman Layanan, tekan Jalankan pm2"],
  cloudflared: ["error", "jalankan: sv up cloudflared (panel docs cloudflare)"],
  postgres: ["warning", "buka halaman Layanan, tekan Jalankan postgres"],
};

function serviceChecks(p: DoctorProbe): DoctorCheck[] {
  const l = group("layanan");
  const svc = (key: DoctorBootstrapKey, name: keyof DoctorProbe["services"]) => {
    const s = p.services[name];
    const [state, hint] = SVC_DOWN[name];
    return s === null
      ? make("layanan", key, state, `Layanan ${name} belum dipasang di runit`, REINSTALL)
      : l(key, s.state === "run", `${name} berjalan`, [state, `${name} tidak berjalan`, hint]);
  };
  const out = [
    l("service_daemon", p.daemonAlive, "runit berjalan", [
      "error",
      "runit (service-daemon) tidak berjalan",
      "buka ulang Termux; bila tetap mati, lihat panel docs android",
    ]),
    svc("svc_panel", "panel"),
    svc("svc_pm2", "pm2"),
    svc("svc_cloudflared", "cloudflared"),
    svc("svc_postgres", "postgres"),
  ];
  if (p.packages.cloudflared === "installed") {
    // D5: the package ships `down`; with a configured tunnel that means every site is offline after a reboot.
    out.push(
      l("cloudflared_down_file", !p.cfDownFile, "cloudflared menyala otomatis", [
        p.cfConfig !== null ? "error" : "warning",
        "cloudflared tidak menyala otomatis (ada file down)",
        "biasanya akibat pkg upgrade; ikuti panel docs paket",
      ]),
    );
    if (p.cfRunScript !== null)
      out.push(
        l(
          "cloudflared_run_script",
          !p.cfRunScript.includes("--token-file"),
          "Run script cloudflared memakai tunnel lokal",
          ["warning", "Run script cloudflared masih template paket", "panel docs paket"],
        ),
      );
  }
  if (p.packages.postgresql === "installed")
    out.push(
      l("postgres_initdb", p.pgDataMajor !== null, "Data PostgreSQL sudah dibuat", [
        "warning",
        "Data PostgreSQL belum dibuat (initdb)",
        REINSTALL,
      ]),
    );
  return out;
}

/** Bootstrap checks for `p` in print order; the caller adds the `situs` group. */
export function bootstrapChecks(p: DoctorProbe): DoctorCheck[] {
  return [
    ...termuxChecks(p),
    ...packageChecks(p),
    ...serviceChecks(p),
    ...panelChecks(p),
    ...tunnelChecks(p),
    group("boot")("termux_boot_script", p.bootScript, "Termux:Boot menyalakan layanan saat HP hidup", [
      "warning",
      "Belum ada skrip Termux:Boot yang menyalakan layanan",
      "panel docs android",
    ]),
    make(
      "manual",
      "android_settings",
      "info",
      "Pengaturan Android: pembatas proses anak, baterai tanpa batasan, autostart (panel docs android)",
    ),
    make(
      "manual",
      "cloudflare_access",
      "info",
      "Cloudflare Access untuk /dev dicek di Administrasi → Penyiapan (panel docs cloudflare)",
    ),
  ];
}
