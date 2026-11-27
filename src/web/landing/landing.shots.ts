import healthDDark from "@/web/assets/landing/health-d-dark.webp";
import healthDLight from "@/web/assets/landing/health-d-light.webp";
import overviewMDark from "@/web/assets/landing/overview-m-dark.webp";
import overviewMLight from "@/web/assets/landing/overview-m-light.webp";
import servicesMDark from "@/web/assets/landing/services-m-dark.webp";
import servicesMLight from "@/web/assets/landing/services-m-light.webp";
import sitesDDark from "@/web/assets/landing/sites-d-dark.webp";
import sitesDLight from "@/web/assets/landing/sites-d-light.webp";
import type { tLanding } from "@/web/i18n/en.landing";

/** The four landing screenshots (PLAN/05 §5.8): `-m` = phone 390×844, `-d` = desktop 1440×900. */
export type ShotKey = keyof typeof tLanding.shots.items;

/** One screenshot: CSS size (phone files are @2x) plus light/dark image URLs. */
export type Shot = {
  key: ShotKey;
  device: "phone" | "desktop";
  width: number;
  height: number;
  light: string;
  dark: string;
};

const PHONE = { device: "phone", width: 390, height: 844 } as const;
const DESKTOP = { device: "desktop", width: 1440, height: 900 } as const;

/** Screenshot registry: hashed WebP URLs from src/web/assets/landing (captured from the demo seed, PLAN/05 §5.8). */
export const SHOTS: Record<ShotKey, Shot> = {
  overview: { key: "overview", ...PHONE, light: overviewMLight, dark: overviewMDark },
  sites: { key: "sites", ...DESKTOP, light: sitesDLight, dark: sitesDDark },
  health: { key: "health", ...DESKTOP, light: healthDLight, dark: healthDDark },
  services: { key: "services", ...PHONE, light: servicesMLight, dark: servicesMDark },
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
