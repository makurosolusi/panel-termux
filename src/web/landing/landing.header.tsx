import { idLanding } from "@/web/i18n/id.landing";
import { BrandLogo } from "@/web/layout/brand.logo";
import { AccountLink, InstallCta } from "./cta.link";

const t = idLanding;
const NAV = [
  { href: "#pasang", label: t.nav.install },
  { href: "#fitur", label: t.nav.features },
  { href: "#cara-kerja", label: t.nav.how },
  { href: "#faq", label: t.nav.faq },
] as const;

/** Sticky top bar: brand, in-page links (≥ md), the account link and (≥ sm) a compact install CTA. */
export function LandingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-lp-line bg-lp-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <a
          href="#top"
          className="inline-flex min-h-11 min-w-0 items-center rounded focus-visible:outline-2 focus-visible:outline-lp-signal"
        >
          <BrandLogo />
        </a>
        <nav aria-label={t.nav.label} className="hidden items-center gap-6 font-lp-mono text-sm text-lp-dim md:flex">
          {NAV.map((n) => (
            <a key={n.href} className="hover:text-lp-ink focus-visible:text-lp-ink" href={n.href}>
              {n.label}
            </a>
          ))}
          <a className="hover:text-lp-ink focus-visible:text-lp-ink" href={t.links.github} rel="noreferrer">
            {t.nav.github}
          </a>
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <AccountLink />
          <span className="hidden sm:inline-flex">
            <InstallCta size="sm" />
          </span>
        </div>
      </div>
    </header>
  );
}
