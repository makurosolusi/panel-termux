// Bootstrap checks of `panel doctor` (PLAN/07 §3.1, K5): pure DoctorProbe → DoctorCheck[]. The Persiapan card
// checks (group `situs`) are not here: doctor.command calls the server's integration service and its copy.
import { EnvError, parseEnv } from "../server/env";
import { ingressHostnames, readTunnelId } from "../server/sites/ingress.editor";
import type { DoctorAction, DoctorBootstrapKey, DoctorCheck, DoctorGroup, DoctorState } from "../shared/doctor.types";
import { ENV_VARS, isEnvValueMissing } from "../shared/env.schema";
import type { JobParams } from "../shared/job.types";
import { type DoctorProbe, HELD_PACKAGES } from "./doctor.probe";

const MB = 1024 * 1024;
/** Below this the panel cannot unpack a deploy or snapshot panel.db (PLAN/07 §3.1). */
const DISK_ERROR_BYTES = 400 * MB;
const DISK_WARN_BYTES = 1024 * MB;
/** `data/` must not be readable by other Android apps' uids (secret, panel.db). */
const GROUP_OTHER_BITS = 0o077;
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const PLAY_STORE = "GOOGLE_PLAY_STORE";
const REINSTALL = "jalankan lagi perintah install.sh (README)";
const FDROID = "pasang ulang Termux dari F-Droid (panel docs android)";
const FREE_SPACE = "kosongkan penyimpanan HP minimal 1 GB";
const CF_DOCS = "panel docs cloudflare";

/** A failing outcome: state, label, next step (→ line), params. */
type Bad = [state: DoctorState, label: string, hint?: string | null, params?: JobParams];

/** `action` follows from the hint, so every → line and its JSON action agree. */
const actionOf = (hint: string | null): DoctorAction =>
  !hint ? null : hint.includes("panel docs") ? "docs" : hint.startsWith("buka ") ? "ui" : "manual";

function make(group: DoctorGroup, key: DoctorBootstrapKey, ...[state, label, hint = null, params = {}]: Bad) {
  return { group, key, state, label, action: actionOf(hint), hint, params } satisfies DoctorCheck;
}

/** Check builder of one group: ok label when `good`, else the Bad outcome. */
const group =
  (g: DoctorGroup) =>
  (key: DoctorBootstrapKey, good: boolean, ok: string, bad: Bad): DoctorCheck =>
    good ? make(g, key, "ok", ok) : make(g, key, ...bad);

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
  const out = [
    pkg("pkg_termux_services", "termux-services", p.packages["termux-services"], "error"),
    pkg("pkg_cloudflared", "cloudflared", p.packages.cloudflared, "error"),
    pkg("node", "node", p.files.node, "error", "nodejs-lts"),
    k("pm2", p.files.pm2Runtime, "pm2", ["error", "pm2 belum terpasang", "jalankan: npm install -g pm2"]),
    pkg("pkg_postgresql", "postgresql", p.packages.postgresql, "warning"),
    pkg("pkg_termux_api", "termux-api", p.packages["termux-api"], "warning"),
  ];
  const installed = HELD_PACKAGES.filter((n) => p.packages[n]);
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
  if (p.packages.cloudflared) {
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
  if (p.packages.postgresql)
    out.push(
      l("postgres_initdb", p.pgDataMajor !== null, "Data PostgreSQL sudah dibuat", [
        "warning",
        "Data PostgreSQL belum dibuat (initdb)",
        REINSTALL,
      ]),
    );
  return out;
}

/** parseEnv's message for a complete .env (names the variable, never its value), or null when valid. */
function envError(values: NonNullable<DoctorProbe["env"]>): string | null {
  try {
    parseEnv(values);
    return null;
  } catch (e) {
    if (e instanceof EnvError) return e.message;
    throw e;
  }
}

function envChecks(p: DoctorProbe): DoctorCheck[] {
  const k = group("panel");
  if (p.env === null)
    return [
      make(
        "panel",
        "env_complete",
        "error",
        "File ~/panel/.env belum ada",
        "buat dengan: panel env > ~/panel/.env, lalu isi nilainya (panel docs google)",
      ),
    ];
  const env = p.env;
  const missing = ENV_VARS.filter((v) => v.required && isEnvValueMissing(v, env[v.name])).map((v) => v.name);
  const complete = k("env_complete", !missing.length, ".env lengkap", [
    "error",
    `.env belum lengkap: ${missing.join(", ")}`,
    "isi nilainya di ~/panel/.env (panel docs google)",
    { missing: missing.join(",") },
  ]);
  if (missing.length) return [complete];
  const invalid = envError(env);
  return [
    complete,
    k("env_valid", invalid === null, ".env valid", [
      "error",
      `.env tidak valid: ${invalid}`,
      "perbaiki nilainya di ~/panel/.env (panel docs google)",
    ]),
  ];
}

function panelChecks(p: DoctorProbe): DoctorCheck[] {
  const k = group("panel");
  const procs = p.panelProcs;
  const outside = procs.length === 1 && procs[0]?.pid !== (p.services.panel?.pid ?? null);
  const out = [
    k("binary_installed", p.files.binary, "Panel terpasang di ~/panel/panel", [
      "error",
      "Panel belum terpasang di ~/panel/panel",
      REINSTALL,
    ]),
    k(
      "panel_instances",
      procs.length <= 1 && !outside,
      "Satu instance panel",
      procs.length > 1
        ? [
            "error",
            `${procs.length} proses panel berjalan bersamaan`,
            "hentikan yang bukan dari runit, lalu jalankan: sv restart panel",
            { count: procs.length },
          ]
        : [
            "warning",
            "Panel berjalan di luar runit",
            "hentikan proses itu, lalu jalankan: sv up panel",
            { pid: procs[0]?.pid ?? null },
          ],
    ),
    ...envChecks(p),
  ];
  const extra = p.envExtraFiles.join(", ");
  if (extra)
    out.push(
      make(
        "panel",
        "env_extra_files",
        "warning",
        `File ${extra} di ~/panel menimpa isi .env`,
        "gabungkan isinya ke ~/panel/.env, lalu hapus file itu",
        { files: extra },
      ),
    );
  if (p.dataDirMode !== null)
    out.push(
      k("data_dir_private", !(p.dataDirMode & GROUP_OTHER_BITS), "Folder data panel privat", [
        "warning",
        "Folder data panel bisa dibaca aplikasi lain",
        "jalankan: chmod 700 ~/panel/data",
      ]),
    );
  out.push(
    k("panel_health", p.panelHealth === HTTP_OK, `Panel menjawab di port ${p.port}`, [
      "error",
      `Panel tidak menjawab di port ${p.port}`,
      "jalankan: sv restart panel",
      { port: p.port },
    ]),
  );
  return out;
}

/** Tunnel id and ingress hosts of config.yml; unparsable YAML is `broken` (cf_config reports it). */
function parseConfig(text: string | null): { id: string | null; hosts: string[]; broken: boolean } {
  if (text === null) return { id: null, hosts: [], broken: false };
  try {
    return { id: readTunnelId(text), hosts: ingressHostnames(text), broken: false };
  } catch {
    return { id: null, hosts: [], broken: true }; // reported as the cf_config label below
  }
}

function tunnelChecks(p: DoctorProbe): DoctorCheck[] {
  const k = group("tunnel");
  const cfg = parseConfig(p.cfConfig);
  const out = [
    k("cf_cert", p.files.cfCert, "Login Cloudflare (cert.pem)", [
      "error",
      "Belum login Cloudflare (cert.pem tidak ada)",
      CF_DOCS,
    ]),
    k("cf_config", cfg.id !== null, "Tunnel ada di ~/.cloudflared/config.yml", [
      "error",
      p.cfConfig === null
        ? "~/.cloudflared/config.yml belum ada"
        : cfg.broken
          ? "config.yml tidak bisa dibaca (YAML rusak)"
          : "config.yml tidak menyebut tunnel",
      CF_DOCS,
    ]),
  ];
  const host = p.publicHost;
  if (host) {
    out.push(
      k("cf_panel_ingress", cfg.hosts.includes(host), `${host} ada di ingress`, [
        "error",
        `${host} belum ada di ingress config.yml`,
        CF_DOCS,
        { host },
      ]),
    );
    const up = p.publicStatus !== null && p.publicStatus < HTTP_SERVER_ERROR;
    out.push(
      k("panel_public", up, `https://${host} terjangkau`, [
        "warning",
        `https://${host} tidak terjangkau dari HP`,
        CF_DOCS,
        { host },
      ]),
    );
  }
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
