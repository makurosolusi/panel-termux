import { getSetting, type SettingKey, type SettingsDeps } from "../settings.service";

/** Settings without a default that must be set before a backup can run. */
const REQUIRED: SettingKey[] = [
  "backup.s3_endpoint",
  "backup.s3_bucket",
  "backup.s3_access_key_id",
  "backup.s3_secret_access_key",
];

/** S3 connection; holds credentials, so never log or return it. */
export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** Effective backup settings; `s3` null when any REQUIRED key is unset (listed in `missing`). */
export type BackupConfig = {
  s3: S3Config | null;
  missing: SettingKey[];
  prefix: string;
  /** Local hour of the daily run, null = schedule off. */
  hour: number | null;
  retentionDays: number;
};

/** Reads the backup settings fresh from the DB (called per run/tick so edits apply without restart). */
export function readBackupConfig(deps: SettingsDeps): BackupConfig {
  const get = (k: SettingKey) => getSetting(deps, k);
  const missing = REQUIRED.filter((k) => get(k) === null);
  const hourRaw = get("backup.hour") ?? "off";
  return {
    s3: missing.length
      ? null
      : {
          endpoint: get("backup.s3_endpoint") as string,
          bucket: get("backup.s3_bucket") as string,
          region: get("backup.s3_region") ?? "auto",
          accessKeyId: get("backup.s3_access_key_id") as string,
          secretAccessKey: get("backup.s3_secret_access_key") as string,
        },
    missing,
    prefix: get("backup.prefix") ?? "panel-termux/",
    hour: hourRaw === "off" ? null : Number(hourRaw),
    retentionDays: Number(get("backup.retention_days") ?? "14"),
  };
}

/** First local `hour`:00 strictly after `from` (local wall-clock, so DST shifts keep the hour). */
export function nextRunAt(hour: number, from: Date): Date {
  const d = new Date(from);
  d.setHours(hour, 0, 0, 0);
  if (d <= from) {
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
  }
  return d;
}

/**
 * Whether a scheduled run fell in (prevTick, now]. Ticking with the previous tick time means no run on
 * boot, at most one run per crossing, and a changed hour applies at the next crossing.
 */
export const isDue = (hour: number | null, prevTick: Date, now: Date): boolean =>
  hour !== null && nextRunAt(hour, prevTick) <= now;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `<prefix><yyyy-mm-dd>/<HHMMSS>-` in local time: the key stem shared by all items of one run. */
export const runKeyStem = (prefix: string, at: Date): string =>
  `${prefix}${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}/` +
  `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-`;
