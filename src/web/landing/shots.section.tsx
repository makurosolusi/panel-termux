import { tLanding } from "@/web/i18n/en.landing";
import { BrowserFrame, PhoneFrame } from "./device.frame";
import { LandingLegacyAnchor } from "./landing.anchors";
import { GALLERY, SHOTS } from "./landing.shots";
import { Screenshot } from "./screenshot";
import { SectionHead } from "./section.head";

const t = tLanding.shots;

/** `#screens`: three screenshots; horizontal scroll-snap on phones, a 3-column grid from md up. */
export function ShotsSection() {
  return (
    <section
      id="screens"
      aria-labelledby="shots-title"
      className="scroll-mt-16 border-y border-lp-line bg-lp-ink/[0.03] py-16 md:py-24"
    >
      <LandingLegacyAnchor of="screens" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead id="shots-title" kicker={t.kicker} title={t.title} />
      </div>
      <ul
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1)
        tabIndex={0}
        aria-label={t.label}
        className="mx-auto mt-12 flex max-w-6xl snap-x snap-mandatory items-end gap-5 overflow-x-auto px-4 pb-4 focus-visible:outline-2 focus-visible:outline-lp-signal sm:px-6 md:grid md:grid-cols-[1fr_1fr_0.5fr] md:overflow-visible"
      >
        {GALLERY.map((key) => {
          const shot = SHOTS[key];
          const Frame = shot.device === "phone" ? PhoneFrame : BrowserFrame;
          return (
            <li
              key={key}
              className={`shrink-0 snap-center ${shot.device === "phone" ? "w-[56%] md:w-auto" : "w-[85%] md:w-auto"}`}
            >
              <figure>
                <Frame>
                  <Screenshot shot={shot} />
                </Frame>
                <figcaption className="mt-3 font-lp-mono text-xs text-lp-dim">{t.items[key].caption}</figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
