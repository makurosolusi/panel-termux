import { useSyncExternalStore } from "react";
import {
  type ResolvedTheme,
  readPreference,
  resolveTheme,
  THEME_COLOR,
  type ThemePreference,
  writePreference,
} from "./theme.preference";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();
let preference: ThemePreference = readPreference(globalThis.localStorage);
let snapshot = { preference, resolved: currentResolved() };

function currentResolved(): ResolvedTheme {
  return resolveTheme(preference, globalThis.matchMedia?.(DARK_QUERY).matches ?? false);
}

/** Writes the resolved theme onto <html> and the theme-color metas, then notifies subscribers. */
function apply() {
  const resolved = currentResolved();
  document.documentElement.dataset.theme = resolved;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", THEME_COLOR[resolved]);
  }
  snapshot = { preference, resolved };
  for (const l of listeners) l();
}

/** Changes and persists the theme preference. */
export function setThemePreference(next: ThemePreference) {
  preference = next;
  writePreference(globalThis.localStorage, next);
  apply();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = globalThis.matchMedia?.(DARK_QUERY);
  const onChange = () => preference === "system" && apply();
  media?.addEventListener("change", onChange);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", onChange);
  };
}

/** Current preference and the theme it resolves to; re-renders on change (incl. OS switch while "system"). */
export const useTheme = () => useSyncExternalStore(subscribe, () => snapshot);
