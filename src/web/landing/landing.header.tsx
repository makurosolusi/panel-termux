import { id } from "@/web/i18n/id";
import { CtaLink } from "./cta.link";

const t = id.landing;

/** Sticky top bar: wordmark, in-page links (desktop) and the compact CTA. */
export function LandingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-lp-line bg-lp-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <a
          href="#top"
          className="flex items-center gap-2 rounded font-lp-mono text-sm font-bold focus-visible:outline-2 focus-visible:outline-lp-signal"
        >
          <span aria-hidden className="grid size-6 place-items-center rounded-md bg-lp-ink text-[11px] text-lp-paper">
            &gt;_
          </span>
          panel-termux
        </a>
        <nav aria-label={t.nav.label} className="hidden items-center gap-6 font-lp-mono text-sm text-lp-dim md:flex">
          <a className="hover:text-lp-ink focus-visible:text-lp-ink" href="#fitur">
            {t.nav.features}
          </a>
          <a className="hover:text-lp-ink focus-visible:text-lp-ink" href="#cara-kerja">
            {t.nav.how}
          </a>
          <a className="hover:text-lp-ink focus-visible:text-lp-ink" href="#faq">
            {t.nav.faq}
          </a>
          <a className="hover:text-lp-ink focus-visible:text-lp-ink" href={t.githubUrl} rel="noreferrer">
            {t.nav.github}
          </a>
        </nav>
        <CtaLink size="sm" />
      </div>
    </header>
  );
}
