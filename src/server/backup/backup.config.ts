import type { BackupVerifyInput } from "../../shared/backup.types";
import { getSetting, KeyMismatchError, type SettingKey, type SettingsDeps } from "../settings.service";

/** Settings without a default that must be set before a backup can run. */
const REQUIRED: SettingKey[] = [
  "backup.s3_endpoint",
  "backup.s3_bucket",
  "backup.s3_access_key_id",
  "backup.s3_secret_access_key",
];

const MB = 1024 * 1024;

/** S3 connection; holds credentials, so never log or return it. */
export type S3Config = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Effective backup settings. `s3` null when any REQUIRED key is unset (listed in `missing`) or a secret key
 * cannot be decrypted with the data key (`keyMismatch`, PLAN/04 K8): reading never throws because of the key.
 */
export type BackupConfig = {
  s3: S3Config | null;
  missing: SettingKey[];
  keyMismatch: boolean;
  prefix: string;
  /** Local hour of the daily run, null = schedule off. */
  hour: number | null;
  retentionDays: number;
  keepMinRuns: number;
  maxItemBytes: number;
  includeSecrets: boolean;
};

/** Reads one setting; a KeyMismatchError marks the config unreadable instead of failing the caller. */
function reader(deps: SettingsDeps) {
  let keyMismatch = false;
  const get = (k: SettingKey): string | null => {
    try {
      return getSetting(deps, k);
    } catch (e) {
      if (!(e instanceof KeyMismatchError)) throw e;
      keyMismatch = true;
      return "";
    }
  };
  return { get, mismatch: () => keyMismatch };
}

/** Reads the backup settings fresh from the DB (called per run/tick so edits apply without restart). */
export function readBackupConfig(deps: SettingsDeps): BackupConfig {
  const { get, mismatch } = reader(deps);
  const missing = REQUIRED.filter((k) => get(k) === null);
  const hourRaw = get("backup.hour") ?? "off";
  const keyMismatch = mismatch();
  return {
    s3:
      missing.length || keyMismatch
        ? null
        : {
            endpoint: get("backup.s3_endpoint") as string,
            bucket: get("backup.s3_bucket") as string,
            region: get("backup.s3_region") ?? "auto",
            accessKeyId: get("backup.s3_access_key_id") as string,
            secretAccessKey: get("backup.s3_secret_access_key") as string,
          },
    missing,
    keyMismatch,
    prefix: get("backup.prefix") ?? "panel-termux/",
    hour: hourRaw === "off" ? null : Number(hourRaw),
    retentionDays: Number(get("backup.retention_days")),
    keepMinRuns: Number(get("backup.keep_min_runs")),
    maxItemBytes: Number(get("backup.max_item_mb")) * MB,
    includeSecrets: get("backup.include_secrets") === "on",
  };
}

/** Draft ∪ stored S3 settings for the connection test; stored keys are read only for fields the draft lacks. */
export function draftS3Config(
  deps: SettingsDeps,
  draft: BackupVerifyInput,
): { s3: S3Config | null; prefix: string; keyMismatch: boolean } {
  const { get, mismatch } = reader(deps);
  const pick = (v: string | undefined, k: SettingKey) => (v?.trim() ? v.trim() : get(k));
  const endpoint = pick(draft.endpoint, "backup.s3_endpoint");
  const bucket = pick(draft.bucket, "backup.s3_bucket");
  const accessKeyId = pick(draft.accessKeyId, "backup.s3_access_key_id");
  const secretAccessKey = pick(draft.secretAccessKey, "backup.s3_secret_access_key");
  const region = pick(draft.region, "backup.s3_region") ?? "auto";
  const prefix = pick(draft.prefix, "backup.prefix") ?? "panel-termux/";
  const complete = endpoint && bucket && accessKeyId && secretAccessKey;
  return {
    s3: complete && !mismatch() ? { endpoint, bucket, region, accessKeyId, secretAccessKey } : null,
    prefix,
    keyMismatch: mismatch(),
  };
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** S3 failures carry Bun's S3 error code (e.g. AccessDenied); credentials are masked defensively. */
export function describeS3Error(e: unknown, s3: S3Config): string {
  const code = s3ErrorCode(e);
  const msg = `${code ? `${code}: ` : ""}${errMsg(e)}`;
  return msg.replaceAll(s3.secretAccessKey, "***").replaceAll(s3.accessKeyId, "***").slice(0, 300);
}

/** Bun's S3Error `code` (AccessDenied, NoSuchBucket, ConnectionRefused, …) or null. */
export function s3ErrorCode(e: unknown): string | null {
  const code = (e as { code?: unknown })?.code;
  return typeof code === "string" ? code : null;
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

/** Local `yyyy-mm-dd` (the run folder and the "local date changed" check of the daily tick). */
export const localDay = (at: Date): string => `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;

/** `<prefix><yyyy-mm-dd>/<HHMMSS>-` in local time: the key stem shared by all items of one run. */
export const runKeyStem = (prefix: string, at: Date): string =>
  `${prefix}${localDay(at)}/${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}-`;

/** `yyyymmddHHMM` local time (restore target suffix, PLAN/04 F10). */
export const minuteStamp = (at: Date): string =>
  `${localDay(at).replaceAll("-", "")}${pad(at.getHours())}${pad(at.getMinutes())}`;
