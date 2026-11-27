// Single env schema (PLAN/07 K17, §6.2): the one list of panel config variables, read by parseEnv, doctor, `panel env`,
// the CLI env scrub (K11b) and `.env.example`. Pure module: imports only src/shared, never src/server.
import { encodeEnvLine } from "./env.codec";
import { DEFAULT_LOCALE, type Locale } from "./locale";

/** One panel config variable. `default` is the value parseEnv uses when unset (as written in `.env`). */
export type EnvVar = {
  name: string;
  required: boolean;
  default?: string;
  /** Sample value shown in the template comment; never set when `secret`. */
  example?: string;
  /** Old sample values (`.env.example` ≤ 0.4.0) that count as empty (debate D7); never printed as a value. */
  placeholders?: readonly string[];
  /** One-line description per locale, the only copy of this text. */
  description: Record<Locale, string>;
  secret: boolean;
};

/** Panel config variables in fixed order: required first (prompt order), then optional. */
export const ENV_VARS = [
  {
    name: "APP_BASE_URL",
    required: true,
    example: "https://panel.example.org",
    placeholders: ["https://panel.example.com"],
    description: {
      en: "Public address of the panel (https://domain, or http://localhost:<port> when local).",
      id: "Alamat publik panel (https://domain, atau http://localhost:<port> saat lokal).",
    },
    secret: false,
  },
  {
    name: "GOOGLE_CLIENT_ID",
    required: true,
    example: "1234-abcd.apps.googleusercontent.com",
    description: {
      en: "Google OAuth Client ID (type Web application).",
      id: "Client ID OAuth Google (tipe Web application).",
    },
    secret: false,
  },
  {
    name: "GOOGLE_CLIENT_SECRET",
    required: true,
    description: {
      en: "Google OAuth Client secret. Secret: never share or commit it.",
      id: "Client secret OAuth Google. Rahasia: jangan dibagikan atau di-commit.",
    },
    secret: true,
  },
  {
    name: "SUPER_ADMIN_EMAILS",
    required: true,
    example: "you@example.org",
    placeholders: ["you@example.com"],
    description: {
      en: "Google emails that become Super Admin, separated by commas.",
      id: "Email Google yang menjadi Super Admin, pisahkan dengan koma.",
    },
    secret: false,
  },
  {
    name: "PORT",
    required: false,
    default: "3200",
    description: {
      en: "Panel port (always listens on 127.0.0.1 only).",
      id: "Port panel (selalu listen di 127.0.0.1 saja).",
    },
    secret: false,
  },
  {
    name: "PANEL_DATA_DIR",
    required: false,
    default: "./data",
    description: {
      en: "Folder of panel.db and the secret (back it up). Relative to the working directory.",
      id: "Folder panel.db dan secret (cadangkan!). Relatif ke working directory.",
    },
    secret: false,
  },
  {
    name: "PANEL_CONNECTIVITY_URL",
    required: false,
    // Same value as CONNECTIVITY_PROBE_URL in src/server/monitor (duplicated to stay pure; equality is tested).
    default: "https://www.gstatic.com/generate_204",
    description: {
      en: 'URL the monitor checks to tell "no internet" from "site down".',
      id: 'URL yang dicek monitor untuk membedakan "tidak ada internet" dari "situs mati".',
    },
    secret: false,
  },
  {
    name: "PANEL_SKIP_SNAPSHOT",
    required: false,
    default: "0",
    description: {
      en: "1 = run migrations even if the panel.db snapshot fails (e.g. disk full). For one start only, then remove it.",
      id: "1 = migrasi tetap jalan walau snapshot panel.db gagal (mis. disk penuh). Hanya untuk satu kali start, lalu hapus.",
    },
    secret: false,
  },
  {
    // Read only by the CLI (cli.locale.ts, DECISIONS E12); the server ignores it, site processes never get it.
    name: "PANEL_LANG",
    required: false,
    default: "en",
    description: {
      en: "Language of the panel CLI: en (English) or id (Bahasa Indonesia). panel init asks once.",
      id: "Bahasa CLI panel: en (English) atau id (Bahasa Indonesia). panel init menanyakannya sekali.",
    },
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

const COPY = {
  en: {
    header: [
      "# Panel Termux — minimal .env. Fill in the empty values, save as ~/panel/.env (chmod 600).",
      "# Other settings (Cloudflare, backup, Telegram, sites, monitor) are in Administration → Settings. Guide: panel docs google",
    ],
    example: "Example:",
    optional: "# --- Optional: remove the # to change the default ---",
  },
  id: {
    header: [
      "# Panel Termux — .env minimal. Isi nilai yang kosong, simpan sebagai ~/panel/.env (chmod 600).",
      "# Pengaturan lain (Cloudflare, backup, Telegram, situs, monitor) ada di Administrasi → Pengaturan. Panduan: panel docs google",
    ],
    example: "Contoh:",
    optional: "# --- Opsional: hapus tanda # untuk mengubah nilai bawaan ---",
  },
} satisfies Record<Locale, { header: string[]; example: string; optional: string }>;

/**
 * `.env` template text (§6.2) with comments in `locale` (default English, like `.env.example`): required vars with
 * empty values; `full` adds optional vars commented out at default.
 */
export function renderEnvTemplate({ full, locale = DEFAULT_LOCALE }: { full: boolean; locale?: Locale }): string {
  const vars: readonly EnvVar[] = ENV_VARS;
  const copy = COPY[locale];
  const lines = [...copy.header, ""];
  for (const v of vars.filter((x) => x.required)) {
    const example = v.example && !v.secret ? ` ${copy.example} ${v.example}` : "";
    lines.push(`# ${v.description[locale]}${example}`, encodeEnvLine(v.name, ""));
  }
  if (full) {
    lines.push("", copy.optional);
    for (const v of vars.filter((x) => !x.required)) {
      lines.push(`# ${v.description[locale]}`, `# ${encodeEnvLine(v.name, v.default ?? "")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
