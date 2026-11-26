import type { idLanding } from "@/web/i18n/id.landing";

/** The four landing screenshots (PLAN/05 §5.8): `-m` = phone 390×844, `-d` = desktop 1440×900. */
export type ShotKey = keyof typeof idLanding.shots.items;

/** One screenshot: intrinsic size plus light/dark image URLs; null until the WebP files exist. */
export type Shot = {
  key: ShotKey;
  device: "phone" | "desktop";
  width: number;
  height: number;
  light: string | null;
  dark: string | null;
};

const PHONE = { device: "phone", width: 390, height: 844 } as const;
const DESKTOP = { device: "desktop", width: 1440, height: 900 } as const;

/**
 * Screenshot registry. W10 fills `light`/`dark` with imports of
 * src/web/assets/landing/{overview-m,sites-d,health-d,services-m}-{light,dark}.webp; until then pages show a placeholder.
 */
export const SHOTS: Record<ShotKey, Shot> = {
  overview: { key: "overview", ...PHONE, light: null, dark: null },
  sites: { key: "sites", ...DESKTOP, light: null, dark: null },
  health: { key: "health", ...DESKTOP, light: null, dark: null },
  services: { key: "services", ...PHONE, light: null, dark: null },
};

/** Gallery order below the hero (the overview shot is the hero image). */
export const GALLERY: readonly ShotKey[] = ["sites", "health", "services"];

/**
 * `<img>` loading attributes: the hero's light variant gets `fetchpriority=high` (most visitors), its dark variant
 * loads eagerly without priority; everything else is lazy (a `display:none` lazy image is never downloaded).
 */
export function imgLoading(priority: boolean, variant: "light" | "dark") {
  if (!priority) return { loading: "lazy", fetchPriority: "auto" } as const;
  return variant === "light"
    ? ({ loading: "eager", fetchPriority: "high" } as const)
    : ({ loading: "eager", fetchPriority: "auto" } as const);
}
