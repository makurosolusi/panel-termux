import { tLanding } from "@/web/i18n/en.landing";
import { LandingLegacyAnchor } from "./landing.anchors";
import { SectionHead } from "./section.head";

const t = tLanding.how;

/** How it works: four numbered steps on a rail, with the real command where one is involved. */
export function StepsSection() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6 md:py-24"
    >
      <LandingLegacyAnchor of="how-it-works" />
      <SectionHead id="how-title" kicker={t.kicker} title={t.title} />
      <ol className="mt-12 grid gap-10 md:grid-cols-4 md:gap-6">
        {t.steps.map((s, i) => (
          <li
            key={s.title}
            className="relative border-l-2 border-lp-ink pl-5 md:border-t-2 md:border-l-0 md:pt-6 md:pl-0"
          >
            <span
              aria-hidden
              className="absolute top-0 -left-[7px] size-3 rounded-full bg-lp-signal md:-top-[7px] md:left-0"
            />
            <span aria-hidden className="font-lp-serif text-5xl leading-none font-semibold text-lp-ink/15">
              {i + 1}
            </span>
            <h3 className="mt-2 font-lp-serif text-xl font-semibold">{s.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-lp-dim">{s.body}</p>
            {"code" in s && (
              <code className="mt-4 block rounded-lg bg-lp-screen px-3 py-2.5 font-lp-mono text-[11px] [overflow-wrap:anywhere] text-white/85">
                <span aria-hidden className="text-lp-signal-bright">
                  ${" "}
                </span>
                {s.code}
              </code>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
