// Pure form logic of /dev/settings (PLAN/05 §5.2): drafts, dirty tracking per card, field status, PATCH error mapping.
import type { BackupVerify, BackupVerifyInput } from "@/shared/backup.types";
import type { CloudflareVerify, DevSetting, DevSettings, DevSettingsPatch, SettingKey } from "@/shared/dev.types";
import { LANGUAGE_NAMES, type Locale } from "@/shared/locale";
import type { StatusTone } from "@/web/components/status.tone";
import { tSettings } from "@/web/i18n/en.settings";
import {
  AJAX_HEADERS,
  ApiError,
  apiErrorMessage,
  errorFromResponse,
  failedResponse,
  REAUTH_REQUIRED,
} from "@/web/shared/api.client";
import { formatRelative } from "@/web/shared/format";
import { devUrl } from "./dev.api";
import { CONNECTION_KEYS, groupKeys, OFF, ON, type SettingGroup } from "./settings.registry";

/** Values sent by one "Simpan" (null = back to default / delete the secret). */
export type PatchValues = DevSettingsPatch["values"];
/** Input text per key of one card. Secrets: "" = keep the stored value. */
export type Drafts = Partial<Record<SettingKey, string>>;

/** Starting input: stored value for overridden plain keys, "" otherwise (default shows as placeholder; secrets write-only). */
export const initialDraft = (s: DevSetting): string => (s.secret || !s.isSet ? "" : (s.value ?? ""));

/** Drafts of the given items. */
export const initialDrafts = (items: readonly DevSetting[]): Drafts =>
  Object.fromEntries(items.map((s) => [s.key, initialDraft(s)]));

/** What a control shows: the draft, or the effective value when the draft is empty (selects, switches). */
export const shownValue = (s: DevSetting, draft: string): string => draft || (s.value ?? "");

/**
 * Keys of `items` whose draft differs from what is stored, with the value to PATCH. Plain: empty = null (default),
 * unchanged when it equals the effective value; secret: only a non-empty draft counts.
 */
export function changedValues(items: readonly DevSetting[], drafts: Drafts): PatchValues {
  const out: PatchValues = {};
  for (const s of items) {
    const key = s.key as SettingKey;
    const raw = (drafts[key] ?? "").trim();
    if (s.secret) {
      if (raw) out[key] = raw;
      continue;
    }
    const next = raw || null;
    if (next === null ? s.isSet : next !== s.value) out[key] = next;
  }
  return out;
}

/** Status of one field, as shown next to its label. */
export type FieldStatus =
  | { kind: "default"; tone: StatusTone }
  | { kind: "notSet"; tone: StatusTone }
  | { kind: "changed"; tone: StatusTone; at: string | null }
  | { kind: "stored"; tone: StatusTone; at: string | null }
  | { kind: "unreadable"; tone: StatusTone };

/** "Bawaan" only when nothing is stored and a default exists; secrets: stored / not set / unreadable (data key changed). */
export function fieldStatus(s: DevSetting): FieldStatus {
  if (s.secret) {
    if (s.readable === false) return { kind: "unreadable", tone: "danger" };
    return s.isSet ? { kind: "stored", tone: "success", at: s.updatedAt } : { kind: "notSet", tone: "neutral" };
  }
  if (s.isSet) return { kind: "changed", tone: "info", at: s.updatedAt };
  return s.default != null ? { kind: "default", tone: "neutral" } : { kind: "notSet", tone: "neutral" };
}

/** A required field with nothing stored (and no draft) — the card opens on phones and shows "Belum lengkap". */
export const missingRequired = (s: DevSetting, required: boolean, draft: string): boolean =>
  required && !draft.trim() && (s.secret ? !s.isSet || s.readable === false : s.value == null);

/** Turning `backup.include_secrets` on needs the honest-warning confirm first. */
export const turnsOnIncludeSecrets = (values: PatchValues, items: readonly DevSetting[]): boolean =>
  values["backup.include_secrets"] === ON && items.find((s) => s.key === "backup.include_secrets")?.value !== ON;

/** Changing the sites folder asks first (existing sites are not moved). */
export const changesSitesDir = (values: PatchValues): boolean => "sites.dir" in values;

/** True when this save should re-run the card's connection test (Cloudflare / S3 only). */
export const needsAutoTest = (group: SettingGroup, values: PatchValues): boolean =>
  (CONNECTION_KEYS[group] ?? []).some((k) => k in values);

/** Unsaved S3 fields of the Cadangan card as the optional draft of POST /api/dev/backup/verify. */
export function s3Draft(drafts: Drafts): BackupVerifyInput {
  const map: Record<keyof BackupVerifyInput, SettingKey> = {
    endpoint: "backup.s3_endpoint",
    bucket: "backup.s3_bucket",
    region: "backup.s3_region",
    accessKeyId: "backup.s3_access_key_id",
    secretAccessKey: "backup.s3_secret_access_key",
    prefix: "backup.prefix",
  };
  const out: BackupVerifyInput = {};
  for (const [field, key] of Object.entries(map) as [keyof BackupVerifyInput, SettingKey][]) {
    const v = drafts[key]?.trim();
    if (v) out[field] = v;
  }
  return out;
}

/** Server reason a single key was rejected. */
export type FieldError = "invalid" | "empty" | "unknown";

/** ApiError of PATCH /api/dev/settings plus the per-key `fields` of a 400. */
export class SettingsPatchError extends ApiError {
  constructor(
    base: ApiError,
    readonly fields: Readonly<Partial<Record<string, FieldError>>>,
  ) {
    super(base.kind, base.status, base.code, base.serverMessage, { cause: base });
  }
}

/** Builds the PATCH error from a failed response and its parsed body. */
export function patchErrorFrom(status: number, body: unknown): SettingsPatchError {
  const raw = (body as { fields?: unknown } | null)?.fields;
  const fields = typeof raw === "object" && raw !== null ? (raw as Partial<Record<string, FieldError>>) : {};
  return new SettingsPatchError(errorFromResponse(status, body), fields);
}

/** Message under a rejected field: the key's own `invalid` text, "Wajib diisi.", or the unknown-key text. */
export function fieldErrorMessage(key: SettingKey, reason: FieldError): string {
  if (reason === "empty") return tSettings.empty;
  if (reason === "unknown") return tSettings.unknownKey;
  return tSettings.fields[key].invalid;
}

/** How the card reacts to a failed save: inline field errors, a notice with an action, or a toast. */
export type SaveFailure = "fields" | "reauth" | "keyMismatch" | "toast";

/** Classifies a failed save. */
export function saveFailure(err: unknown): SaveFailure {
  if (!(err instanceof ApiError)) return "toast";
  if (err.code === REAUTH_REQUIRED) return "reauth";
  if (err.code === "key_mismatch") return "keyMismatch";
  if (err instanceof SettingsPatchError && Object.keys(err.fields).length > 0) return "fields";
  return "toast";
}

/** Keys of one card present in `items`, in registry order. */
export const groupItems = (group: SettingGroup, items: readonly DevSetting[]): DevSetting[] =>
  groupKeys(group).flatMap((k) => items.find((s) => s.key === k) ?? []);

/** What a connection test shows: tone + sentence (+ technical detail when the server gave one). */
export type TestOutcome = { tone: "success" | "warning" | "danger"; text: string; detail?: string | null };

const tt = tSettings.test;

/** Outcome of POST /api/dev/cloudflare/verify: zone count when known; "no zones" is a warning. */
export function cloudflareOutcome(r: CloudflareVerify): TestOutcome {
  if (r.ok) return { tone: "success", text: r.zones == null ? tt.cloudflare.ok : tt.cloudflareZones(r.zones) };
  return { tone: r.code === "no_zones" ? "warning" : "danger", text: tt.cloudflare[r.code], detail: r.detail };
}

/** Outcome of POST /api/dev/backup/verify, with the round-trip time on success. */
export function s3Outcome(r: BackupVerify): TestOutcome {
  if (r.ok) return { tone: "success", text: `${tt.s3.ok} (${tt.s3Ms(r.ms)})` };
  return { tone: r.code === "delete_denied" ? "warning" : "danger", text: tt.s3[r.code], detail: r.detail };
}

/** Outcome of a failed test call: Telegram codes first (test send, chat lookup), then the settings/generic API message. */
export function testFailure(err: unknown): TestOutcome {
  const code = err instanceof ApiError ? err.code : null;
  const known = code && code in tt.telegram ? tt.telegram[code as keyof typeof tt.telegram] : null;
  return {
    tone: code === "too_soon" ? "warning" : "danger",
    text: known ?? apiErrorMessage(err, tSettings.errorCodes),
  };
}

/**
 * PATCH /api/dev/settings (atomic). Throws SettingsPatchError carrying the 400 `fields` (apiFetch drops the body);
 * a 403 `reauth_required` stays on the page so the card can offer "Masuk ulang".
 */
export async function patchSettings(values: PatchValues): Promise<DevSetting[]> {
  let res: Response;
  try {
    res = await fetch(devUrl("/settings"), {
      method: "PATCH",
      credentials: "same-origin",
      headers: { ...AJAX_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({ values }),
    });
  } catch (cause) {
    throw new SettingsPatchError(new ApiError("network", null, null, null, { cause }), {});
  }
  const parsed: unknown = await res.json().catch(() => null); // proxy error page → no body
  if (res.ok && parsed) return (parsed as DevSettings).items;
  failedResponse(res.status, parsed); // navigation only: Access reload or /login (never for reauth_required)
  throw patchErrorFrom(res.status, parsed);
}

/** Status pill text of a field ("Default", "Stored · changed 3 days ago", …). */
export function statusLabel(s: FieldStatus, now: Date): string {
  const ago = (at: string | null) => (at ? formatRelative(at, now) : null);
  switch (s.kind) {
    case "default":
      return tSettings.status.default;
    case "notSet":
      return tSettings.status.notSet;
    case "unreadable":
      return tSettings.secret.unreadable;
    case "changed": {
      const a = ago(s.at);
      return a ? tSettings.status.changed(a) : tSettings.status.changedNoDate;
    }
    case "stored": {
      const a = ago(s.at);
      return a ? tSettings.secret.stored(a) : tSettings.secret.storedNoDate;
    }
  }
}

/** Label of a select choice. */
export function choiceLabel(key: SettingKey, v: string): string {
  if (v === OFF) return tSettings.options.off;
  if (key === "alerts.min_severity") return tSettings.options.severity[v as "warning" | "danger"] ?? v;
  if (key === "alerts.language") return LANGUAGE_NAMES[v as Locale] ?? v;
  return tSettings.options.hour(Number(v));
}
