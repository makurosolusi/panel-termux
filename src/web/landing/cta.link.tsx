import { ArrowRightIcon } from "lucide-react";
import { Link, useRouteLoaderData } from "react-router";
import type { MeResult } from "@/web/session/session.api";
import { ROOT_ROUTE_ID } from "@/web/session/use-me";
import { landingCta } from "./landing.cta";

const SIZES = {
  sm: "h-9 px-3.5 text-sm",
  lg: "h-12 px-6 text-base",
} as const;

/**
 * Primary landing CTA: "Masuk dengan Google" or "Buka panel", from the root `/api/me` loader result.
 * "Buka panel" is a full document load so Cloudflare Access can challenge the protected home path.
 */
export function CtaLink({ size = "lg", inverted = false }: { size?: keyof typeof SIZES; inverted?: boolean }) {
  const cta = landingCta(useRouteLoaderData(ROOT_ROUTE_ID) as MeResult | undefined);
  const palette = inverted
    ? "bg-lp-ink text-lp-paper focus-visible:outline-lp-ink"
    : "bg-lp-signal text-lp-signal-ink focus-visible:outline-lp-signal";
  return (
    <Link
      to={cta.to}
      reloadDocument={cta.kind === "open"}
      className={`group inline-flex items-center gap-2.5 rounded-full font-lp-mono font-semibold tracking-tight shadow-[0_1px_0_0_rgb(0_0_0/0.25)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${SIZES[size]} ${palette}`}
    >
      {cta.kind === "signIn" && <GoogleMark />}
      {cta.label}
      <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1a6.18 6.18 0 0 1 0-12.36c1.76 0 2.94.75 3.62 1.4l2.47-2.38C16.5 3.36 14.47 2.4 12 2.4a9.6 9.6 0 1 0 0 19.2c5.54 0 9.2-3.9 9.2-9.38 0-.63-.07-1.11-.15-1.6z"
      />
    </svg>
  );
}
