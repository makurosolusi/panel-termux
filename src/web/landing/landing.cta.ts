import { homeFor } from "@/shared/roles";
import { tLanding } from "@/web/i18n/en.landing";
import type { MeResult } from "@/web/session/session.api";
import { LOGIN_PATH } from "@/web/session/session.redirect";

/** Header account link on the landing page; `open`/`account` go to Access-protected paths (full page load). */
export type LandingCta = { kind: "signIn" | "open" | "account"; label: string; to: string };

/** Guests → "Masuk" (/login); `user` → "Akun saya" (/profile); admin and super_admin → "Buka panel" (/panel). */
export function landingCta(result: MeResult | undefined): LandingCta {
  if (result?.status !== "ok") return { kind: "signIn", label: tLanding.cta.signIn, to: LOGIN_PATH };
  const to = homeFor(result.me.role); // from the role, never from the payload's `home`
  return result.me.role === "user"
    ? { kind: "account", label: tLanding.cta.account, to }
    : { kind: "open", label: tLanding.cta.open, to };
}
