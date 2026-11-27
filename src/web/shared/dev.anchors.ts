// /dev and /dev/settings anchor ids and their 0.5.x aliases. Lives outside src/web/dev and stays dictionary-free so the
// entry-chunk hash scroll (hash.scroll.ts) can resolve them without pulling app code into `/` (bundle:check).

/** Anchor of the onboarding card on /dev (target of the banner and the Information rows). */
export const ONBOARDING_ANCHOR = "setup";
/** Anchor of PLAN/04's DataKeyCard on /dev (download lives there, with its fresh-session handling). */
export const DATA_KEY_ANCHOR = "data-key";
/** 0.5.x Indonesian ids of the two /dev anchors, kept so old bookmarks and stored problem links still land. */
const LEGACY_DEV_ANCHOR: Readonly<Record<string, string>> = {
  penyiapan: ONBOARDING_ANCHOR,
  "kunci-data": DATA_KEY_ANCHOR,
};

/** Anchor named by a /dev URL hash (`#kunci-data` → `data-key`); an unknown id passes through unchanged. */
export function devAnchorFromHash(hash: string): string {
  const id = hash.replace(/^#/, "");
  return LEGACY_DEV_ANCHOR[id] ?? id;
}

/** Indonesian /dev/settings card anchors of 0.5.x, kept so old bookmarks and README links land (PLAN/08 §5). */
const LEGACY_SETTINGS_ANCHOR: Readonly<Record<string, string>> = {
  cadangan: "backup",
  notifikasi: "alerts",
  situs: "sites",
  pemantauan: "monitor",
  keamanan: "security",
};

/** Settings card anchor named by a URL hash (`#cadangan` → `backup`); an unknown id passes through unchanged. */
export function settingsAnchorFromHash(hash: string): string {
  const id = hash.replace(/^#/, "");
  return LEGACY_SETTINGS_ANCHOR[id] ?? id;
}
