// Landing section anchors: English ids, plus the Indonesian ids before 0.6.0 as hidden aliases so old links
// (`/#pasang` in READMEs, account pages, shared links) still land. Remove the aliases in 0.7.0 with the site ones
// (site.legacy-anchor.tsx; the landing chunk must not import site code).

/** English landing section id → its Indonesian id before 0.6.0. */
export const LANDING_LEGACY_ANCHORS = {
  install: "pasang",
  features: "fitur",
  "how-it-works": "cara-kerja",
  limits: "batasan",
  screens: "layar",
} as const;

/** Invisible scroll target with the old id, first child of the section with the new id (all use `scroll-mt-16`). */
export function LandingLegacyAnchor({ of }: { of: keyof typeof LANDING_LEGACY_ANCHORS }) {
  return <span id={LANDING_LEGACY_ANCHORS[of]} aria-hidden className="sr-only scroll-mt-16" />;
}
