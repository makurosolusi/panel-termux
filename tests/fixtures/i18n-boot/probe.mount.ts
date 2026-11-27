// Test-only stand-in for src/web/app.mount.tsx in tests/i18n.boot.test.ts: reads dictionary values the way the app
// does (module-level aliases, a dictionary in a shared chunk) and publishes them on globalThis.
import { tApp } from "@/web/i18n/en.app";

/** What the boot test asserts on. */
export type BootProbe = { lang: string; packFailed: boolean; signOut: string; lazySignOut: string; anchor: string };

/** Same signature as the real `mount`. */
export function mount({ packFailed }: { packFailed: boolean }): void {
  const g = globalThis as { __i18nProbe?: Promise<BootProbe> };
  g.__i18nProbe = (async () => {
    const lazy = await import("./probe.lazy");
    const { SITE_ANCHORS } = await import("@/web/site/site.anchors");
    return {
      lang: document.documentElement.lang,
      packFailed,
      signOut: tApp.menu.signOut,
      lazySignOut: lazy.SIGN_OUT,
      anchor: SITE_ANCHORS[0].label,
    };
  })();
}
