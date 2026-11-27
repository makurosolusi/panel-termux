import { tLanding } from "@/web/i18n/en.landing";
import { LandingLegacyAnchor } from "./landing.anchors";
import { SectionHead } from "./section.head";

const t = tLanding.limits;

/** `#limits`: honest limitations, as a numbered two-column list. */
export function LimitsSection() {
  return (
    <section
      id="limits"
      aria-labelledby="limits-title"
      className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6 md:py-24"
    >
      <LandingLegacyAnchor of="limits" />
      <SectionHead id="limits-title" kicker={t.kicker} title={t.title} />
      <ol className="mt-12 grid gap-x-10 border-t border-lp-ink/80 md:grid-cols-2">
        {t.items.map((item, i) => (
          <li key={item.title} className="grid grid-cols-[2.25rem_1fr] border-b border-lp-line py-5">
            <span aria-hidden className="font-lp-mono text-xs leading-7 text-lp-signal">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h3 className="font-lp-serif text-lg font-semibold">{item.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-lp-dim">{item.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
