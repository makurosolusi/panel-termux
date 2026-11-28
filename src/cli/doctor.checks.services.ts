// Service checks of `panel doctor` (split from doctor.checks.ts): one row per runit service of the probe.
import type { DoctorBootstrapKey, DoctorCheck, DoctorState } from "../shared/doctor.types";
import { tr } from "./cli.locale";
import { group, make, reinstall } from "./doctor.checks.base";
import type { DoctorProbe } from "./doctor.probe";

/** State and next step when a runit service is down (pm2/postgres have a start button in the UI). */
const SVC_DOWN: Record<keyof DoctorProbe["services"], [DoctorState, () => string]> = {
  panel: ["error", () => tr("run: sv up panel", "jalankan: sv up panel")],
  pm2: ["error", () => tr("open the Services page, press Start pm2", "buka halaman Layanan, tekan Jalankan pm2")],
  cloudflared: [
    "error",
    () => tr("run: sv up cloudflared (panel docs cloudflare)", "jalankan: sv up cloudflared (panel docs cloudflare)"),
  ],
  postgres: [
    "warning",
    () => tr("open the Services page, press Start postgres", "buka halaman Layanan, tekan Jalankan postgres"),
  ],
};

/** Checks of the `layanan` group: one row per runit service in the probe. */
export function serviceChecks(p: DoctorProbe): DoctorCheck[] {
  const l = group("layanan");
  const svc = (key: DoctorBootstrapKey, name: keyof DoctorProbe["services"]) => {
    const s = p.services[name];
    const [state, hint] = SVC_DOWN[name];
    return s === null
      ? make(
          "layanan",
          key,
          state,
          tr(`The ${name} service is not set up in runit`, `Layanan ${name} belum dipasang di runit`),
          reinstall(),
        )
      : l(key, s.state === "run", tr(`${name} is running`, `${name} berjalan`), [
          state,
          tr(`${name} is not running`, `${name} tidak berjalan`),
          hint(),
        ]);
  };
  const out = [
    l("service_daemon", p.daemonAlive, tr("runit is running", "runit berjalan"), [
      "error",
      tr("runit (service-daemon) is not running", "runit (service-daemon) tidak berjalan"),
      tr(
        "reopen Termux; if it stays down, see panel docs android",
        "buka ulang Termux; bila tetap mati, lihat panel docs android",
      ),
    ]),
    svc("svc_panel", "panel"),
    svc("svc_pm2", "pm2"),
    svc("svc_cloudflared", "cloudflared"),
    svc("svc_postgres", "postgres"),
  ];
  if (p.packages.cloudflared === "installed") {
    // D5: the package ships `down`; with a configured tunnel that means every site is offline after a reboot.
    out.push(
      l(
        "cloudflared_down_file",
        !p.cfDownFile,
        tr("cloudflared starts automatically", "cloudflared menyala otomatis"),
        [
          p.cfConfig !== null ? "error" : "warning",
          tr(
            "cloudflared does not start automatically (there is a down file)",
            "cloudflared tidak menyala otomatis (ada file down)",
          ),
          tr(
            "usually caused by pkg upgrade; follow panel docs packages",
            "biasanya akibat pkg upgrade; ikuti panel docs packages",
          ),
        ],
      ),
    );
    if (p.cfRunScript !== null)
      out.push(
        l(
          "cloudflared_run_script",
          !p.cfRunScript.includes("--token-file"),
          tr("The cloudflared run script uses the local tunnel", "Run script cloudflared memakai tunnel lokal"),
          [
            "warning",
            tr(
              "The cloudflared run script is still the package template",
              "Run script cloudflared masih template paket",
            ),
            "panel docs packages",
          ],
        ),
      );
  }
  // SSH is optional: only checked when sshd is in use (runit runs it, or the user started one by hand), else the
  // package's default `down` file would warn on every phone that never used SSH. A warning, not an error: the panel
  // keeps running, but after a reboot the user loses their way in.
  if (p.sshd.supervised || p.sshd.manual)
    out.push(
      l(
        "sshd_boot",
        p.sshd.supervised && !p.sshd.down,
        tr("sshd starts automatically when the phone boots", "sshd menyala otomatis saat HP hidup"),
        [
          "warning",
          p.sshd.down
            ? tr(
                "sshd will not start when the phone boots (the sshd service has a down file)",
                "sshd tidak menyala saat HP hidup (layanan sshd punya file down)",
              )
            : tr(
                "sshd runs by hand, not under runit: it will not start when the phone boots",
                "sshd berjalan manual, bukan lewat runit: tidak menyala saat HP hidup",
              ),
          tr(
            "run: panel init --ssh-key <key file, https URL or -> (removes the down file, puts sshd under runit)",
            "jalankan: panel init --ssh-key <file kunci, URL https atau -> (menghapus file down, sshd ikut runit)",
          ),
        ],
      ),
    );
  if (p.packages.postgresql === "installed")
    out.push(
      l("postgres_initdb", p.pgDataMajor !== null, tr("PostgreSQL data exists", "Data PostgreSQL sudah dibuat"), [
        "warning",
        tr("PostgreSQL data has not been created yet (initdb)", "Data PostgreSQL belum dibuat (initdb)"),
        reinstall(),
      ]),
    );
  return out;
}
