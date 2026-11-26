import { homeFor } from "@/shared/roles";
import { idLanding } from "@/web/i18n/id.landing";
import type { MeResult } from "@/web/session/session.api";
import { LOGIN_PATH } from "@/web/session/session.redirect";

/** Primary call to action on the landing page. */
export type LandingCta = { kind: "signIn" | "open"; label: string; to: string };

/** Anonymous visitors get "sign in" (→ /login); signed-in ones get "open panel" (→ their role home). */
export function landingCta(result: MeResult | undefined): LandingCta {
  if (result?.status === "ok") return { kind: "open", label: idLanding.cta.open, to: homeFor(result.me.role) };
  return { kind: "signIn", label: idLanding.cta.signIn, to: LOGIN_PATH };
}
