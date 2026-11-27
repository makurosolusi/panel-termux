// Device labels of sessions and audit rows (PLAN/08 §5, DECISIONS E10). New rows are written locale-neutral
// ("Chrome · Android", null when unknown); rows written before 0.6.0 hold Indonesian text and are normalized on read.

/** Separator between browser and OS in a stored device label. */
export const DEVICE_SEPARATOR = " · ";

/** Unknown-device text that 0.5.x stored in audit rows (replaced by null since 0.6.0). */
const LEGACY_UNKNOWN = "Perangkat tidak dikenal";
const LEGACY_SEPARATOR = " di ";

/** Locale-neutral label "Browser · OS", or whichever part is known; null when neither is. */
export function deviceLabel(browser: string | undefined, os: string | undefined): string | null {
  if (browser && os) return `${browser}${DEVICE_SEPARATOR}${os}`;
  return browser ?? os ?? null;
}

/** Stored label (old or new format) → locale-neutral label; null = unknown device (the UI renders its own text). */
export function normalizeDeviceLabel(raw: string | null): string | null {
  const s = raw?.trim();
  if (!s || s === LEGACY_UNKNOWN) return null;
  return s.replace(LEGACY_SEPARATOR, DEVICE_SEPARATOR).replace(/ \(baris perintah\)$/, "");
}
