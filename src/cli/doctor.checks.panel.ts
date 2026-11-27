// `panel doctor` checks of ~/panel (.env, binary, instances, data dir, health) and of the Cloudflare tunnel
// (PLAN/07 §3.1): pure DoctorProbe → DoctorCheck[].
import { EnvError, parseEnv } from "../server/env";
import { ingressHostnames, readTunnelId } from "../server/sites/ingress.editor";
import type { DoctorCheck } from "../shared/doctor.types";
import { ENV_VARS, isEnvValueMissing } from "../shared/env.schema";
import { tr } from "./cli.locale";
import { group, make, reinstall } from "./doctor.checks.base";
import type { DoctorProbe } from "./doctor.probe";

/** `data/` must not be readable by other Android apps' uids (secret, panel.db). */
const GROUP_OTHER_BITS = 0o077;
const HTTP_OK = 200;
const HTTP_SERVER_ERROR = 500;
const CF_DOCS = "panel docs cloudflare";

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
        tr("The file ~/panel/.env does not exist yet", "File ~/panel/.env belum ada"),
        tr(
          "create it with: panel env > ~/panel/.env, then fill in the values (panel docs google)",
          "buat dengan: panel env > ~/panel/.env, lalu isi nilainya (panel docs google)",
        ),
      ),
    ];
  const env = p.env;
  const missing = ENV_VARS.filter((v) => v.required && isEnvValueMissing(v, env[v.name])).map((v) => v.name);
  const complete = k("env_complete", !missing.length, tr(".env is complete", ".env lengkap"), [
    "error",
    tr(`.env is incomplete: ${missing.join(", ")}`, `.env belum lengkap: ${missing.join(", ")}`),
    tr("fill in the values in ~/panel/.env (panel docs google)", "isi nilainya di ~/panel/.env (panel docs google)"),
    { missing: missing.join(",") },
  ]);
  if (missing.length) return [complete];
  const invalid = envError(env);
  return [
    complete,
    k("env_valid", invalid === null, tr(".env is valid", ".env valid"), [
      "error",
      tr(`.env is invalid: ${invalid}`, `.env tidak valid: ${invalid}`),
      tr(
        "correct the value in ~/panel/.env (panel docs google)",
        "perbaiki nilainya di ~/panel/.env (panel docs google)",
      ),
    ]),
  ];
}

/** Group `panel`: binary, single instance, .env, extra env files, data dir mode, /api/health. */
export function panelChecks(p: DoctorProbe): DoctorCheck[] {
  const k = group("panel");
  const procs = p.panelProcs;
  const outside = procs.length === 1 && procs[0]?.pid !== (p.services.panel?.pid ?? null);
  const out = [
    k("binary_installed", p.files.binary, tr("Panel installed at ~/panel/panel", "Panel terpasang di ~/panel/panel"), [
      "error",
      tr("The panel is not installed at ~/panel/panel", "Panel belum terpasang di ~/panel/panel"),
      reinstall(),
    ]),
    k(
      "panel_instances",
      procs.length <= 1 && !outside,
      tr("One panel instance", "Satu instance panel"),
      procs.length > 1
        ? [
            "error",
            tr(
              `${procs.length} panel processes are running at once`,
              `${procs.length} proses panel berjalan bersamaan`,
            ),
            tr(
              "stop the ones not started by runit, then run: sv restart panel",
              "hentikan yang bukan dari runit, lalu jalankan: sv restart panel",
            ),
            { count: procs.length },
          ]
        : [
            "warning",
            tr("The panel is running outside runit", "Panel berjalan di luar runit"),
            tr("stop that process, then run: sv up panel", "hentikan proses itu, lalu jalankan: sv up panel"),
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
        tr(`The file ${extra} in ~/panel overrides .env`, `File ${extra} di ~/panel menimpa isi .env`),
        tr(
          "merge its content into ~/panel/.env, then delete that file",
          "gabungkan isinya ke ~/panel/.env, lalu hapus file itu",
        ),
        { files: extra },
      ),
    );
  if (p.dataDirMode !== null)
    out.push(
      k(
        "data_dir_private",
        !(p.dataDirMode & GROUP_OTHER_BITS),
        tr("Panel data folder is private", "Folder data panel privat"),
        [
          "warning",
          tr("Other apps can read the panel data folder", "Folder data panel bisa dibaca aplikasi lain"),
          tr("run: chmod 700 ~/panel/data", "jalankan: chmod 700 ~/panel/data"),
        ],
      ),
    );
  out.push(
    k(
      "panel_health",
      p.panelHealth === HTTP_OK,
      tr(`Panel answers on port ${p.port}`, `Panel menjawab di port ${p.port}`),
      [
        "error",
        tr(`The panel does not answer on port ${p.port}`, `Panel tidak menjawab di port ${p.port}`),
        tr("run: sv restart panel", "jalankan: sv restart panel"),
        { port: p.port },
      ],
    ),
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

/** Group `tunnel`: cert.pem, config.yml tunnel, panel ingress host, public reachability. */
export function tunnelChecks(p: DoctorProbe): DoctorCheck[] {
  const k = group("tunnel");
  const cfg = parseConfig(p.cfConfig);
  const out = [
    k("cf_cert", p.files.cfCert, tr("Cloudflare login (cert.pem)", "Login Cloudflare (cert.pem)"), [
      "error",
      tr("Not logged in to Cloudflare (no cert.pem)", "Belum login Cloudflare (cert.pem tidak ada)"),
      CF_DOCS,
    ]),
    k(
      "cf_config",
      cfg.id !== null,
      tr("Tunnel set in ~/.cloudflared/config.yml", "Tunnel ada di ~/.cloudflared/config.yml"),
      [
        "error",
        p.cfConfig === null
          ? tr("~/.cloudflared/config.yml does not exist yet", "~/.cloudflared/config.yml belum ada")
          : cfg.broken
            ? tr("config.yml cannot be read (broken YAML)", "config.yml tidak bisa dibaca (YAML rusak)")
            : tr("config.yml names no tunnel", "config.yml tidak menyebut tunnel"),
        CF_DOCS,
      ],
    ),
  ];
  const host = p.publicHost;
  if (host) {
    out.push(
      k("cf_panel_ingress", cfg.hosts.includes(host), tr(`${host} is in the ingress`, `${host} ada di ingress`), [
        "error",
        tr(`${host} is not in the config.yml ingress yet`, `${host} belum ada di ingress config.yml`),
        CF_DOCS,
        { host },
      ]),
    );
    const up = p.publicStatus !== null && p.publicStatus < HTTP_SERVER_ERROR;
    out.push(
      k("panel_public", up, tr(`https://${host} is reachable`, `https://${host} terjangkau`), [
        "warning",
        tr(`https://${host} is not reachable from the phone`, `https://${host} tidak terjangkau dari HP`),
        CF_DOCS,
        { host },
      ]),
    );
  }
  return out;
}
