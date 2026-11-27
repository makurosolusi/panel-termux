// Web-side shape of /dev/settings (PLAN/05 §5.2): which card each key sits in and which control edits it.
// Validation stays on the server (B8); labels live in id.settings.ts.
import { SETTING_KEYS, type SettingKey } from "@/shared/dev.types";
import { LOCALES } from "@/shared/locale";

/** Settings cards, in page order. */
export const SETTING_GROUPS = ["cloudflare", "backup", "alerts", "sites", "monitor", "security"] as const;
/** One settings card. */
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/** `#anchor` of each card; health/onboarding link to `#cloudflare` and `#cadangan`. */
export const GROUP_ANCHOR = {
  cloudflare: "cloudflare",
  backup: "cadangan",
  alerts: "notifikasi",
  sites: "situs",
  monitor: "pemantauan",
  security: "keamanan",
} as const satisfies Record<SettingGroup, string>;

/** Control that edits a key: free text, write-only secret, on/off switch, fixed choices, or a number that can be off. */
export type SettingControl = "text" | "secret" | "switch" | "select" | "number" | "numberOrOff";

/** Web metadata of one key. `required` = the card's feature does not work without it. */
export type SettingFieldDef = {
  group: SettingGroup;
  control: SettingControl;
  required?: boolean;
  /** Stored values of a `select`, in display order. */
  choices?: readonly string[];
  /** "Cara membuatnya" link. */
  helpUrl?: string;
};

/** Stored value of a switched-off setting (`backup.hour`, `monitor.battery_warn_percent`, switches). */
export const OFF = "off";
/** Stored value of a switched-on switch. */
export const ON = "on";

const LAST_HOUR = 23;
const HOURS = [OFF, ...Array.from({ length: LAST_HOUR + 1 }, (_, h) => String(h))] as const;

const CF_TOKEN_HELP = "https://developers.cloudflare.com/fundamentals/api/get-started/create-token/";
const R2_TOKEN_HELP = "https://developers.cloudflare.com/r2/api/tokens/";
const BOTFATHER_HELP = "https://core.telegram.org/bots/features#botfather";

/** Every key's card and control. */
export const SETTING_FIELDS = {
  "cloudflare.api_token": { group: "cloudflare", control: "secret", required: true, helpUrl: CF_TOKEN_HELP },
  "cloudflare.account_id": { group: "cloudflare", control: "text" },
  "sites.dir": { group: "sites", control: "text" },
  "sites.port_range": { group: "sites", control: "text" },
  "panel.protected_services": { group: "security", control: "text" },
  "backup.s3_endpoint": { group: "backup", control: "text", required: true },
  "backup.s3_bucket": { group: "backup", control: "text", required: true },
  "backup.s3_region": { group: "backup", control: "text" },
  "backup.s3_access_key_id": { group: "backup", control: "secret", required: true, helpUrl: R2_TOKEN_HELP },
  "backup.s3_secret_access_key": { group: "backup", control: "secret", required: true },
  "backup.prefix": { group: "backup", control: "text" },
  "backup.hour": { group: "backup", control: "select", choices: HOURS },
  "backup.retention_days": { group: "backup", control: "number" },
  "backup.keep_min_runs": { group: "backup", control: "number" },
  "backup.include_secrets": { group: "backup", control: "switch" },
  "backup.max_item_mb": { group: "backup", control: "number" },
  "audit.retention_days": { group: "security", control: "number" },
  "alerts.enabled": { group: "alerts", control: "switch" },
  "alerts.telegram_bot_token": { group: "alerts", control: "secret", required: true, helpUrl: BOTFATHER_HELP },
  "alerts.telegram_chat_id": { group: "alerts", control: "text", required: true },
  "alerts.min_severity": { group: "alerts", control: "select", choices: ["warning", "danger"] },
  "alerts.language": { group: "alerts", control: "select", choices: LOCALES },
  "monitor.sample_interval_sec": { group: "monitor", control: "number" },
  "monitor.battery_warn_percent": { group: "monitor", control: "numberOrOff" },
} as const satisfies Record<SettingKey, SettingFieldDef>;

/** Metadata of a key (typed wide, so optional fields can be read without narrowing). */
export const fieldDef = (key: SettingKey): SettingFieldDef => SETTING_FIELDS[key];

/** Keys of a card, in registry order. */
export const groupKeys = (group: SettingGroup): SettingKey[] => SETTING_KEYS.filter((k) => fieldDef(k).group === group);

/** Keys whose change re-runs the card's connection test after "Simpan" (only these two cards test automatically). */
export const CONNECTION_KEYS: Partial<Record<SettingGroup, readonly SettingKey[]>> = {
  cloudflare: ["cloudflare.api_token", "cloudflare.account_id"],
  backup: [
    "backup.s3_endpoint",
    "backup.s3_bucket",
    "backup.s3_region",
    "backup.s3_access_key_id",
    "backup.s3_secret_access_key",
    "backup.prefix",
  ],
};

/** True when a key is known to the web registry (GET may carry 0.2.x free keys until W7). */
export const isRegisteredKey = (key: string): key is SettingKey => key in SETTING_FIELDS;
