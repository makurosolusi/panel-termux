import type { DevSetting, DevSettingPut } from "@/shared/dev.types";

/** What the field shows next to its label. */
export type SettingStatus = "saved" | "notSet" | "custom" | "default";

/** Starting input value: secrets are write-only, so their input always starts empty. */
export const initialDraft = (s: DevSetting): string => (s.secret ? "" : (s.value ?? ""));

/** Body for "Simpan", or null when there is nothing to send (unchanged value / empty secret input). */
export function saveBody(s: DevSetting, draft: string): DevSettingPut | null {
  if (s.secret) return draft === "" ? null : { value: draft };
  return draft === (s.value ?? "") ? null : { value: draft };
}

/** Body for "Kembalikan ke bawaan" / "Hapus nilai" (secret): null resets to the default. */
export const RESET_BODY: DevSettingPut = { value: null };

/** Reset/clear only makes sense when an explicit value is stored. */
export const canReset = (s: DevSetting): boolean => s.isSet;

/** Secret: stored or not; plain: overridden or default. */
export function settingStatus(s: DevSetting): SettingStatus {
  if (s.secret) return s.isSet ? "saved" : "notSet";
  return s.isSet ? "custom" : "default";
}
