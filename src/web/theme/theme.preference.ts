/** User's theme choice; "system" follows prefers-color-scheme. */
export type ThemePreference = "system" | "light" | "dark";

/** Theme actually applied to the page. */
export type ResolvedTheme = "light" | "dark";

/** localStorage key; the inline boot script in index.html reads the same key — keep them in sync. */
export const THEME_STORAGE_KEY = "panel-termux:theme";

/** Browser-chrome colour per theme (= --background); also hard-coded in index.html's boot script. */
export const THEME_COLOR: Record<ResolvedTheme, string> = { light: "#fdfcf9", dark: "#0f0b09" };

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** Narrows a stored value to a preference; anything unknown means "system". */
export const parsePreference = (v: unknown): ThemePreference =>
  THEME_PREFERENCES.includes(v as ThemePreference) ? (v as ThemePreference) : "system";

/** Light or dark for a preference given whether the OS prefers dark. */
export const resolveTheme = (pref: ThemePreference, systemDark: boolean): ResolvedTheme =>
  pref === "system" ? (systemDark ? "dark" : "light") : pref;

/** Stored preference; storage can be missing or throw (private mode, blocked site data) → "system". */
export function readPreference(storage: Pick<Storage, "getItem"> | undefined): ThemePreference {
  try {
    return parsePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system"; // unreadable storage is not an error for the user: fall back to the OS setting
  }
}

/** Persists the preference; returns false when storage refused (the choice then lasts this page load only). */
export function writePreference(storage: Pick<Storage, "setItem"> | undefined, pref: ThemePreference): boolean {
  try {
    storage?.setItem(THEME_STORAGE_KEY, pref);
    return storage !== undefined;
  } catch {
    return false;
  }
}
