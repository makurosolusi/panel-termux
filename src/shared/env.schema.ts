// Single env schema (PLAN/07 K17, §6.2): the one list of panel config variables, read by parseEnv, doctor, `panel env`,
// the CLI env scrub (K11b) and `.env.example`. Pure module: imports only src/shared, never src/server.
import { encodeEnvLine } from "./env.codec";

/** One panel config variable. `default` is the value parseEnv uses when unset (as written in `.env`). */
export type EnvVar = {
  name: string;
  required: boolean;
  default?: string;
  /** Sample value shown in the template comment; never set when `secret`. */
  example?: string;
  /** Old sample values (`.env.example` ≤ 0.4.0) that count as empty (debate D7); never printed as a value. */
  placeholders?: readonly string[];
  /** One-line Indonesian description, the only copy of this text. */
  description: string;
  secret: boolean;
};

/** Panel config variables in fixed order: required first (prompt order), then optional. */
export const ENV_VARS = [
  {
    name: "APP_BASE_URL",
    required: true,
    example: "https://panel.contoh.com",
    placeholders: ["https://panel.example.com"],
    description: "Alamat publik panel (https://domain, atau http://localhost:<port> saat lokal).",
    secret: false,
  },
  {
    name: "GOOGLE_CLIENT_ID",
    required: true,
    example: "1234-abcd.apps.googleusercontent.com",
    description: "Client ID OAuth Google (tipe Web application).",
    secret: false,
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    required: true,
    description: "Client secret OAuth Google. Rahasia: jangan dibagikan atau di-commit.",
    secret: true,
  },
  {
    name: "SUPER_ADMIN_EMAILS",
    required: true,
    example: "kamu@contoh.com",
    placeholders: ["you@example.com"],
    description: "Email Google yang menjadi super admin, pisahkan dengan koma.",
    secret: false,
  },
  {
    name: "PORT",
    required: false,
    default: "3200",
    description: "Port panel (selalu listen di 127.0.0.1 saja).",
    secret: false,
  },
  {
    name: "PANEL_DATA_DIR",
    required: false,
    default: "./data",
    description: "Folder panel.db dan secret (cadangkan!). Relatif ke working directory.",
    secret: false,
  },
  {
    name: "PANEL_CONNECTIVITY_URL",
    required: false,
    // Same value as CONNECTIVITY_PROBE_URL in src/server/monitor (duplicated to stay pure; equality is tested).
    default: "https://www.gstatic.com/generate_204",
    description: 'URL yang dicek monitor untuk membedakan "tidak ada internet" dari "situs mati".',
    secret: false,
  },
  {
    name: "PANEL_SKIP_SNAPSHOT",
    required: false,
    default: "0",
    description:
      "1 = migrasi tetap jalan walau snapshot panel.db gagal (mis. disk penuh). Hanya untuk satu kali start, lalu hapus.",
    secret: false,
  },
  {
    // Read only by the CLI (cli.locale.ts, DECISIONS E12); the server ignores it, site processes never get it.
    name: "PANEL_LANG",
    required: false,
    default: "en",
    description: "Bahasa CLI panel: en (English) atau id (Bahasa Indonesia). panel init menanyakannya sekali.",
    secret: false,
  },
] as const satisfies readonly EnvVar[];

/** Name of a panel config variable. */
export type EnvVarName = (typeof ENV_VARS)[number]["name"];

/** True when `value` counts as unset for `v`: missing, blank, or one of its old placeholders (D7). */
export function isEnvValueMissing(v: EnvVar, value: string | null | undefined): boolean {
  const s = value?.trim();
  return !s || (v.placeholders?.includes(s) ?? false);
}

const HEADER = [
  "# Panel Termux — .env minimal. Isi nilai yang kosong, simpan sebagai ~/panel/.env (chmod 600).",
  "# Pengaturan lain (Cloudflare, backup, Telegram, situs, monitor) ada di /dev → Pengaturan. Panduan: panel docs google",
];

/** `.env` template text (§6.2): required vars with empty values; `full` adds optional vars commented out at default. */
export function renderEnvTemplate({ full }: { full: boolean }): string {
  const vars: readonly EnvVar[] = ENV_VARS;
  const lines = [...HEADER, ""];
  for (const v of vars.filter((x) => x.required)) {
    lines.push(`# ${v.description}${v.example && !v.secret ? ` Contoh: ${v.example}` : ""}`, encodeEnvLine(v.name, ""));
  }
  if (full) {
    lines.push("", "# --- Opsional: hapus tanda # untuk mengubah nilai bawaan ---");
    for (const v of vars.filter((x) => !x.required)) {
      lines.push(`# ${v.description}`, `# ${encodeEnvLine(v.name, v.default ?? "")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
