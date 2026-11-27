// Old Indonesian anchor ids kept as scroll targets for one release (PLAN/08 §5). No dictionary imports: the Sites
// page chunk uses this too.

/**
 * English anchor id → its Indonesian id before 0.6.0, so old bookmarks and links still land. Remove in 0.7.0
 * together with `?akun=dihapus` (PLAN/08 §5).
 */
export const LEGACY_ANCHORS = { overview: "ringkasan", setup: "persiapan", "not-managed": "belum-dikelola" } as const;

/**
 * Invisible scroll target carrying the old id, placed as the first child of the element with the new id (absolute, so
 * it takes no room in flex/grid flow). `scrollMargin` repeats that element's `scroll-mt-*` classes.
 */
export function LegacyAnchor({
  of,
  scrollMargin = "scroll-mt-32 md:scroll-mt-28",
}: {
  of: keyof typeof LEGACY_ANCHORS;
  scrollMargin?: string;
}) {
  return <span id={LEGACY_ANCHORS[of]} aria-hidden className={`sr-only ${scrollMargin}`} />;
}
