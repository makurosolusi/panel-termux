// Bootstrap checks of `panel doctor` (PLAN/07 §3.1, K5): pure DoctorProbe → DoctorCheck[], text in the CLI locale. The
// Setup card checks (group `situs`) are not here: doctor.command calls the server's integration service and its copy.
import type { DoctorBootstrapKey, DoctorCheck, DoctorState } from "../shared/doctor.types";
import { tr } from "./cli.locale";
import { group, make } from "./doctor.checks.base";
import { panelChecks, tunnelChecks } from "./doctor.checks.panel";
import { serviceChecks } from "./doctor.checks.services";
import { type DoctorProbe, HELD_PACKAGES, type PackageState } from "./doctor.probe";

const MB = 1024 * 1024;
/** Below this the panel cannot unpack a deploy or snapshot panel.db (PLAN/07 §3.1). */
const DISK_ERROR_BYTES = 400 * MB;
const DISK_WARN_BYTES = 1024 * MB;
const PLAY_STORE = "GOOGLE_PLAY_STORE";
const fdroid = () =>
  tr("reinstall Termux from F-Droid (panel docs android)", "pasang ulang Termux dari F-Droid (panel docs android)");
const freeSpace = () => tr("free up at least 1 GB of phone storage", "kosongkan penyimpanan HP minimal 1 GB");

/** `1.5 GB` (English) / `1,5 GB` (Indonesian decimal comma). */
const gb = (bytes: number) => {
  const n = (bytes / 1024 / MB).toFixed(1);
  return `${tr(n, n.replace(".", ","))} GB`;
};

function termuxChecks(p: DoctorProbe): DoctorCheck[] {
  const t = group("termux");
  const src = p.termuxEnv.TERMUX_APK_RELEASE;
  const free = p.freeBytes;
  const app = (key: DoctorBootstrapKey, name: string, has: boolean | null) =>
    has === null
      ? make(
          "termux",
          key,
          "info",
          tr(
            `${name} cannot be checked (cmd package does not answer)`,
            `${name} tidak bisa dicek (cmd package tidak menjawab)`,
          ),
        )
      : t(key, has, tr(`${name} installed`, `${name} terpasang`), [
          "warning",
          tr(`${name} is not installed`, `${name} belum terpasang`),
          tr(`install ${name} from F-Droid (panel docs android)`, `pasang ${name} dari F-Droid (panel docs android)`),
        ]);
  const pacman = p.termuxEnv.TERMUX_APP_PACKAGE_MANAGER === "pacman" && p.files.pacman;
  return [
    t("arch_arm64", p.arch === "arm64", tr("64-bit phone (arm64)", "HP 64-bit (arm64)"), [
      "error",
      tr(
        `Architecture ${p.arch} is not supported, the panel needs a 64-bit phone (arm64)`,
        `Arsitektur ${p.arch} tidak didukung, panel butuh HP 64-bit (arm64)`,
      ),
      null,
      { arch: p.arch },
    ]),
    t("termux_prefix", p.isTermux, tr("Running in Termux", "Berjalan di Termux"), [
      "error",
      tr("The Termux folder ($PREFIX) was not found", "Folder Termux ($PREFIX) tidak ditemukan"),
      fdroid(),
    ]),
    src
      ? t("termux_source", src !== PLAY_STORE, tr("Termux from F-Droid/GitHub", "Termux dari F-Droid/GitHub"), [
          "error",
          tr(
            "Termux from the Play Store is outdated and not supported",
            "Termux dari Play Store sudah usang dan tidak didukung",
          ),
          fdroid(),
        ])
      : make(
          "termux",
          "termux_source",
          "info",
          tr(
            "Termux source unknown (TERMUX_APK_RELEASE is not set)",
            "Asal Termux tidak diketahui (TERMUX_APK_RELEASE tidak diset)",
          ),
        ),
    free === null
      ? make("termux", "disk_free", "info", tr("Free space cannot be read", "Ruang kosong tidak bisa dibaca"))
      : t("disk_free", free >= DISK_WARN_BYTES, tr(`Free space ${gb(free)}`, `Ruang kosong ${gb(free)}`), [
          free < DISK_ERROR_BYTES ? "error" : "warning",
          tr(`Only ${gb(free)} of free space left`, `Ruang kosong tinggal ${gb(free)}`),
          freeSpace(),
        ]),
    t("pkg_manager_apt", p.files.apt, tr("Package manager apt", "Pengelola paket apt"), [
      "error",
      pacman
        ? tr("Termux uses pacman, the panel only supports apt", "Termux memakai pacman, panel hanya mendukung apt")
        : tr("apt was not found in Termux", "apt tidak ditemukan di Termux"),
      fdroid(),
    ]),
    app("app_termux_boot", "Termux:Boot", p.apps.boot),
    app("app_termux_api", "Termux:API", p.apps.api),
  ];
}

function packageChecks(p: DoctorProbe): DoctorCheck[] {
  const k = group("paket");
  const pkg = (key: DoctorBootstrapKey, name: string, has: boolean, state: DoctorState, install = name) =>
    k(key, has, name, [
      state,
      tr(`${name} is not installed`, `${name} belum terpasang`),
      tr(`run: pkg install ${install}`, `jalankan: pkg install ${install}`),
    ]);
  // Broken (half-installed/unpacked): no pkg command, a reinstall could upgrade a held package (C15).
  const dpkg = (key: DoctorBootstrapKey, name: string, s: PackageState, state: DoctorState) =>
    s === "broken"
      ? make(
          "paket",
          key,
          state,
          tr(`${name} is installed incompletely`, `${name} terpasang tidak lengkap`),
          tr(
            "repair the package installation (panel docs packages)",
            "perbaiki pemasangan paket (panel docs packages)",
          ),
        )
      : pkg(key, name, s === "installed", state);
  const out = [
    dpkg("pkg_termux_services", "termux-services", p.packages["termux-services"], "error"),
    dpkg("pkg_cloudflared", "cloudflared", p.packages.cloudflared, "error"),
    pkg("node", "node", p.files.node, "error", "nodejs-lts"),
    k("pm2", p.files.pm2Runtime, "pm2", [
      "error",
      tr("pm2 is not installed", "pm2 belum terpasang"),
      tr("run: npm install -g pm2", "jalankan: npm install -g pm2"),
    ]),
    dpkg("pkg_postgresql", "postgresql", p.packages.postgresql, "warning"),
    dpkg("pkg_termux_api", "termux-api", p.packages["termux-api"], "warning"),
  ];
  const installed = HELD_PACKAGES.filter((n) => p.packages[n] === "installed");
  if (installed.length && p.held !== null) {
    const and = tr(" and ", " dan ");
    const loose = installed.filter((n) => !p.held?.includes(n)).join(and);
    out.push(
      k(
        "pkg_held",
        !loose,
        tr(
          `${installed.join(and)} held from automatic upgrades`,
          `${installed.join(and)} ditahan dari upgrade otomatis`,
        ),
        [
          "warning",
          tr(`${loose} not held (apt-mark hold)`, `${loose} tidak ditahan (apt-mark hold)`),
          tr(
            "pkg upgrade can take down the tunnel or the database (panel docs packages)",
            "pkg upgrade bisa mematikan tunnel atau database (panel docs packages)",
          ),
          { packages: loose },
        ],
      ),
    );
  }
  const { pgDataMajor: data, pgBinMajor: bin } = p;
  if (data && bin)
    out.push(
      k(
        "postgres_major",
        data === bin,
        tr(`PostgreSQL version matches the data (${bin})`, `Versi PostgreSQL cocok dengan data (${bin})`),
        [
          "error",
          tr(
            `PostgreSQL data is version ${data}, the program is version ${bin}: the database cannot run`,
            `Data PostgreSQL versi ${data}, program versi ${bin}: database tidak bisa jalan`,
          ),
          tr("restore with dump/restore (panel docs packages)", "pulihkan dengan dump/restore (panel docs packages)"),
          { data, program: bin },
        ],
      ),
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
    group("boot")(
      "termux_boot_script",
      p.bootScript,
      tr("Termux:Boot starts the services when the phone turns on", "Termux:Boot menyalakan layanan saat HP hidup"),
      [
        "warning",
        tr("No Termux:Boot script starts the services yet", "Belum ada skrip Termux:Boot yang menyalakan layanan"),
        "panel docs android",
      ],
    ),
    make(
      "manual",
      "android_settings",
      "info",
      tr(
        "Android settings: child process limit, unrestricted battery, autostart (panel docs android)",
        "Pengaturan Android: pembatas proses anak, baterai tanpa batasan, autostart (panel docs android)",
      ),
    ),
    make(
      "manual",
      "cloudflare_access",
      "info",
      tr(
        "Cloudflare Access for /dev is checked in Administration → Set up Panel Termux (panel docs cloudflare)",
        "Cloudflare Access untuk /dev dicek di Administrasi → Penyiapan (panel docs cloudflare)",
      ),
    ),
  ];
}
