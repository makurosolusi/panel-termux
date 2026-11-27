import { homedir } from "node:os";
import { join } from "node:path";
import type { SettingKey } from "../shared/dev.types";
import { DEFAULT_LOCALE, LOCALES } from "../shared/locale";

/** Server-side definition of one setting: storage + validation only; labels live in the web (B8). */
export type SettingDef = {
  secret: boolean;
  default: string | null;
  /** Returns an error message for an invalid (already trimmed, non-empty) value, null when valid. */
  validate: (v: string) => string | null;
  /** Turns the stored/default value into what callers use (e.g. expands `~`). */
  resolve?: (v: string) => string;
};

const MIN_UNPRIVILEGED_PORT = 1024;
const MAX_PORT = 65535;
const CF_TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;
const CF_ACCOUNT_RE = /^[0-9a-f]{32}$/i;
const PORT_RANGE_RE = /^(\d+)-(\d+)$/;
const SERVICE_NAME_RE = /^[A-Za-z0-9._-]+$/;
const MAX_PATH_LEN = 4096;

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const REGION_RE = /^[a-z0-9-]{1,32}$/;
const S3_KEY_RE = /^[A-Za-z0-9+/=_-]{8,256}$/;
const PREFIX_RE = /^[A-Za-z0-9._-][A-Za-z0-9._/-]*\/$/;
const MAX_PREFIX_LEN = 256;
const LAST_HOUR = 23;
const MAX_RETENTION_DAYS = 365;
const MAX_KEEP_MIN_RUNS = 50;
const MAX_ITEM_MB_LIMIT = 65536;
const AUDIT_RETENTION_MIN_DAYS = 90;
const AUDIT_RETENTION_MAX_DAYS = 3650;
const SAMPLE_INTERVAL_MIN_SEC = 30;
const SAMPLE_INTERVAL_MAX_SEC = 600;
// Below 15 % is always danger (B3), so the warn threshold starts above it.
const BATTERY_WARN_MIN = 16;
const BATTERY_WARN_MAX = 100;

const TELEGRAM_TOKEN_RE = /^\d{5,16}:[A-Za-z0-9_-]{30,64}$/;
const TELEGRAM_CHAT_RE = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;

const intIn = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
const wholeIn = (min: number, max: number) => (v: string) =>
  intIn(v, min, max) ? null : `must be a whole number ${min}-${max}`;
const oneOf =
  (...allowed: string[]) =>
  (v: string) =>
    allowed.includes(v) ? null : `must be one of ${allowed.join(", ")}`;
const onOff = oneOf("on", "off");

/** http(s) origin only: no credentials in the URL, no path/query (the bucket goes in the path). */
function validateEndpoint(v: string): string | null {
  const bad =
    "must be an http(s) URL without credentials, path or query, e.g. https://<account>.r2.cloudflarestorage.com";
  try {
    const u = new URL(v);
    const ok =
      (u.protocol === "https:" || u.protocol === "http:") &&
      !u.username &&
      !u.password &&
      (u.pathname === "/" || u.pathname === "") &&
      !u.search &&
      !u.hash;
    return ok ? null : bad;
  } catch {
    return bad; // URL() throws on unparseable input; that is exactly the invalid case.
  }
}

const expandHome = (p: string) => (p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p);
const s3Key = (v: string) => (S3_KEY_RE.test(v) ? null : "must be 8-256 characters of A-Z, a-z, 0-9, + / = _ -");

/** Every runtime setting editable in /dev, keyed by SETTING_KEYS (one list, B8). */
export const SETTINGS = {
  "cloudflare.api_token": {
    secret: true,
    default: null,
    validate: (v) => (CF_TOKEN_RE.test(v) ? null : "must be 20-200 characters of A-Z, a-z, 0-9, _ or -"),
  },
  "cloudflare.account_id": {
    secret: false,
    default: null,
    validate: (v) => (CF_ACCOUNT_RE.test(v) ? null : "must be 32 hex characters"),
  },
  "sites.dir": {
    secret: false,
    default: "~/sites",
    validate: (v) =>
      (v.startsWith("/") || v === "~" || v.startsWith("~/")) && v.length <= MAX_PATH_LEN && !v.includes("\0")
        ? null
        : "must be an absolute path or start with ~/",
    resolve: expandHome,
  },
  "sites.port_range": {
    secret: false,
    default: "3001-3999",
    validate: (v) => {
      const m = v.match(PORT_RANGE_RE);
      const [a, b] = [Number(m?.[1]), Number(m?.[2])];
      return m && MIN_UNPRIVILEGED_PORT < a && a < b && b < MAX_PORT + 1
        ? null
        : `must be a-b with ${MIN_UNPRIVILEGED_PORT} < a < b <= ${MAX_PORT}`;
    },
  },
  "panel.protected_services": {
    secret: false,
    default: "sshd,cloudflared,panel,pm2,postgres",
    validate: (v) =>
      v.split(",").every((s) => SERVICE_NAME_RE.test(s.trim()))
        ? null
        : "must be a comma-separated list of service names (A-Z, a-z, 0-9, . _ -)",
  },
  "backup.s3_endpoint": { secret: false, default: null, validate: validateEndpoint },
  "backup.s3_bucket": {
    secret: false,
    default: null,
    validate: (v) => (BUCKET_RE.test(v) ? null : "must be 3-63 characters of a-z, 0-9, . or -"),
  },
  "backup.s3_region": {
    secret: false,
    default: "auto",
    validate: (v) => (REGION_RE.test(v) ? null : "must be 1-32 characters of a-z, 0-9 or -"),
  },
  "backup.s3_access_key_id": { secret: true, default: null, validate: s3Key },
  "backup.s3_secret_access_key": { secret: true, default: null, validate: s3Key },
  "backup.prefix": {
    secret: false,
    default: "panel-termux/",
    validate: (v) =>
      PREFIX_RE.test(v) && v.length <= MAX_PREFIX_LEN && !v.includes("//") && !v.split("/").includes("..")
        ? null
        : "must be a relative key prefix of A-Z, a-z, 0-9, . _ - / ending with /",
  },
  "backup.hour": {
    secret: false,
    default: "3",
    validate: (v) => (v === "off" || intIn(v, 0, LAST_HOUR) ? null : "must be an hour 0-23 or off"),
  },
  "backup.retention_days": { secret: false, default: "14", validate: wholeIn(1, MAX_RETENTION_DAYS) },
  "backup.keep_min_runs": { secret: false, default: "3", validate: wholeIn(1, MAX_KEEP_MIN_RUNS) },
  "backup.include_secrets": { secret: false, default: "off", validate: onOff },
  "backup.max_item_mb": { secret: false, default: "2048", validate: wholeIn(1, MAX_ITEM_MB_LIMIT) },
  "audit.retention_days": {
    secret: false,
    default: "365",
    validate: wholeIn(AUDIT_RETENTION_MIN_DAYS, AUDIT_RETENTION_MAX_DAYS),
  },
  "alerts.enabled": { secret: false, default: "on", validate: onOff },
  "alerts.telegram_bot_token": {
    secret: true,
    default: null,
    validate: (v) => (TELEGRAM_TOKEN_RE.test(v) ? null : "must look like <bot id>:<30-64 characters>"),
  },
  "alerts.telegram_chat_id": {
    secret: false,
    default: null,
    validate: (v) => (TELEGRAM_CHAT_RE.test(v) ? null : "must be a numeric chat id or @channel name"),
  },
  "alerts.min_severity": { secret: false, default: "warning", validate: oneOf("warning", "danger") },
  // Language of Telegram texts (E11): a panel setting, the chat has no viewer. Migration 0009 sets `id` on upgrades.
  "alerts.language": { secret: false, default: DEFAULT_LOCALE, validate: oneOf(...LOCALES) },
  "monitor.sample_interval_sec": {
    secret: false,
    default: "60",
    validate: wholeIn(SAMPLE_INTERVAL_MIN_SEC, SAMPLE_INTERVAL_MAX_SEC),
  },
  "monitor.battery_warn_percent": {
    secret: false,
    default: "25",
    validate: (v) =>
      v === "off" || intIn(v, BATTERY_WARN_MIN, BATTERY_WARN_MAX)
        ? null
        : `must be off or a whole number ${BATTERY_WARN_MIN}-${BATTERY_WARN_MAX}`,
  },
} satisfies Record<SettingKey, SettingDef>;
