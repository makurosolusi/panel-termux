import { ArrowDownIcon } from "lucide-react";
import { Link, useRouteLoaderData } from "react-router";
import { idLanding } from "@/web/i18n/id.landing";
import type { MeResult } from "@/web/session/session.api";
import { ROOT_ROUTE_ID } from "@/web/session/use-me";
import { landingCta } from "./landing.cta";

const SIZES = {
  sm: "h-11 px-4 text-sm",
  lg: "h-12 px-6 text-base",
} as const;

/** Primary landing CTA "Pasang di HP-mu": jumps to the install section (`#pasang`). */
export function InstallCta({ size = "lg", inverted = false }: { size?: keyof typeof SIZES; inverted?: boolean }) {
  const palette = inverted
    ? "bg-lp-ink text-lp-paper focus-visible:outline-lp-ink"
    : "bg-lp-signal text-lp-signal-ink focus-visible:outline-lp-signal";
  return (
    <a
      href="#pasang"
      className={`group inline-flex items-center gap-2.5 rounded-full font-lp-mono font-semibold tracking-tight shadow-[0_1px_0_0_rgb(0_0_0/0.25)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${SIZES[size]} ${palette}`}
    >
      {idLanding.cta.install}
      <ArrowDownIcon className="size-4 transition-transform group-hover:translate-y-0.5" aria-hidden />
    </a>
  );
}

/**
 * Small header link from the root `/api/me` loader result: "Masuk", "Buka panel" or "Akun saya". Signed-in targets
 * are a full document load so Cloudflare Access can challenge the protected path.
 */
export function AccountLink() {
  const cta = landingCta(useRouteLoaderData(ROOT_ROUTE_ID) as MeResult | undefined);
  return (
    <Link
      to={cta.to}
      reloadDocument={cta.kind !== "signIn"}
      className="inline-flex h-11 items-center rounded px-2 font-lp-mono text-sm font-semibold whitespace-nowrap underline decoration-lp-signal decoration-2 underline-offset-[6px] hover:text-lp-signal focus-visible:outline-2 focus-visible:outline-lp-signal"
    >
      {cta.label}
    </Link>
  );
}
