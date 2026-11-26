import type { CSSProperties } from "react";
import { idLanding } from "@/web/i18n/id.landing";
import { InstallCta } from "./cta.link";
import { PhoneFrame } from "./device.frame";
import { SHOTS } from "./landing.shots";
import { Screenshot } from "./screenshot";

const t = idLanding;
const stagger = (i: number) => ({ "--lp-i": i }) as CSSProperties;

/** Hero: headline, lead, install + GitHub CTAs, the phone screenshot and the spec strip. */
export function HeroSection() {
  return (
    <section id="top" aria-labelledby="hero-title" className="mx-auto max-w-6xl px-4 pt-12 pb-16 sm:px-6 md:pt-20">
      <div className="grid items-center gap-14 md:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="lp-rise font-lp-mono text-xs tracking-wide text-lp-dim uppercase" style={stagger(0)}>
            <span aria-hidden className="mr-2 text-lp-signal">
              ●
            </span>
            {t.hero.eyebrow}
          </p>
          <h1
            id="hero-title"
            className="lp-rise mt-5 font-lp-serif text-[2.6rem] leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl"
            style={stagger(1)}
          >
            <span className="block text-lp-dim">{t.hero.titleA}</span>
            {t.hero.titleB}{" "}
            <em className="relative inline-block text-lp-signal italic">
              {t.hero.titleEm}
              <svg
                aria-hidden
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
                className="absolute -bottom-1 left-0 h-2.5 w-full"
              >
                <path
                  d="M2 9 C 50 2, 120 2, 198 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                />
              </svg>
            </em>{" "}
            {t.hero.titleC}
          </h1>
          <p className="lp-rise mt-6 max-w-xl text-lg leading-relaxed text-lp-dim" style={stagger(2)}>
            {t.hero.lead}
          </p>
          <div className="lp-rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-4" style={stagger(3)}>
            <InstallCta />
            <a
              href={t.links.github}
              rel="noreferrer"
              className="inline-flex h-11 items-center rounded font-lp-mono text-sm font-semibold underline decoration-lp-signal decoration-2 underline-offset-[6px] hover:text-lp-signal focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lp-signal"
            >
              {t.cta.github}
            </a>
          </div>
        </div>
        <figure className="lp-rise relative mx-auto w-full max-w-[17rem]" style={stagger(4)}>
          <PhoneFrame className="md:rotate-[2deg]">
            <Screenshot shot={SHOTS.overview} priority />
          </PhoneFrame>
          <figcaption className="mt-4 text-center font-lp-mono text-[11px] text-lp-dim">
            {t.hero.shotCaption}
          </figcaption>
        </figure>
      </div>
      <SpecStrip />
    </section>
  );
}

function SpecStrip() {
  return (
    <dl aria-label={t.specs.label} className="mt-16 grid grid-cols-2 border-y border-lp-ink/80 md:grid-cols-4">
      {t.specs.items.map((s, i) => (
        <div
          key={s.unit}
          className={`px-3 py-5 sm:px-5 ${i % 2 ? "border-l border-lp-line" : ""} ${i > 1 ? "border-t border-lp-line md:border-t-0" : ""} ${i === 2 ? "md:border-l" : ""}`}
        >
          <dt className="sr-only">{`${s.value} ${s.unit}`}</dt>
          <dd>
            <span aria-hidden className="font-lp-serif text-4xl font-semibold sm:text-5xl">
              {s.value}
            </span>
            <span aria-hidden className="ml-1.5 font-lp-mono text-sm font-semibold text-lp-signal">
              {s.unit}
            </span>
            <span className="mt-1 block font-lp-mono text-xs leading-snug text-lp-dim">{s.note}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
