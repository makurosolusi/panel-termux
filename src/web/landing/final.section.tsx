import { idLanding } from "@/web/i18n/id.landing";
import { InstallCta } from "./cta.link";

const t = idLanding;
const FOOTER_LINKS = [
  { href: t.links.license, label: t.footer.license },
  { href: t.links.changelog, label: t.footer.changelog },
  { href: t.links.releases, label: t.footer.releases },
] as const;

/** Closing CTA band in signal orange. */
export function FinalSection() {
  return (
    <section aria-labelledby="final-title" className="px-4 pb-16 sm:px-6">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-lp-signal px-6 py-14 text-lp-signal-ink sm:px-12 md:py-20">
        <span
          aria-hidden
          className="pointer-events-none absolute -right-6 -bottom-16 font-lp-mono text-[11rem] leading-none font-bold opacity-10 select-none"
        >
          &gt;_
        </span>
        <h2
          id="final-title"
          className="relative max-w-2xl font-lp-serif text-4xl leading-tight font-semibold sm:text-6xl"
        >
          {t.final.title}
        </h2>
        <p className="relative mt-4 max-w-xl text-lg opacity-85">{t.final.body}</p>
        <div className="relative mt-8">
          <InstallCta inverted />
        </div>
      </div>
    </section>
  );
}

/** Page footer: tagline, GitHub, MIT license, changelog and releases. */
export function LandingFooter() {
  const link =
    "inline-flex min-h-11 items-center gap-2 rounded hover:text-lp-ink focus-visible:outline-2 focus-visible:outline-lp-signal";
  return (
    <footer className="border-t border-lp-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 font-lp-mono text-xs text-lp-dim md:flex-row md:items-center md:justify-between sm:px-6">
        <p>
          <span className="font-bold text-lp-ink">Panel Termux</span> — {t.footer.tagline}
        </p>
        <nav aria-label={t.footer.label} className="flex flex-wrap items-center gap-x-5">
          <a href={t.links.github} rel="noreferrer" className={link}>
            <GithubMark />
            {t.footer.github}
          </a>
          {FOOTER_LINKS.map((l) => (
            <a key={l.href} href={l.href} rel="noreferrer" className={link}>
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}

function GithubMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="currentColor"
        d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"
      />
    </svg>
  );
}
