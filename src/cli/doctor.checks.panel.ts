// `panel doctor` checks of ~/panel (.env, binary, instances, data dir, health) and of the Cloudflare tunnel
// (PLAN/07 §3.1): pure DoctorProbe → DoctorCheck[].
import { EnvError, parseEnv } from "../server/env";
import { ingressHostnames, readTunnelId } from "../server/sites/ingress.editor";
import type { DoctorCheck } from "../shared/doctor.types";
import { ENV_VARS, isEnvValueMissing } from "../shared/env.schema";
import { group, make, REINSTALL } from "./doctor.checks.base";
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

/** Group `panel`: binary, single instance, .env, extra env files, data dir mode, /api/health. */
export function panelChecks(p: DoctorProbe): DoctorCheck[] {
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

/** Group `tunnel`: cert.pem, config.yml tunnel, panel ingress host, public reachability. */
export function tunnelChecks(p: DoctorProbe): DoctorCheck[] {
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
