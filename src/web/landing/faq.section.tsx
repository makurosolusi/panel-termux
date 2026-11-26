import { PlusIcon } from "lucide-react";
import { idLanding } from "@/web/i18n/id.landing";
import { SectionHead } from "./section.head";

const t = idLanding.faq;

/** FAQ as native disclosure widgets (keyboard and screen-reader friendly without JS). */
export function FaqSection() {
  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6 md:py-24"
    >
      <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr]">
        <SectionHead id="faq-title" kicker={t.kicker} title={t.title} />
        <div className="border-t border-lp-ink/80">
          {t.items.map((item) => (
            <details key={item.q} className="group border-b border-lp-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 font-lp-serif text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lp-signal [&::-webkit-details-marker]:hidden">
                {item.q}
                <PlusIcon
                  className="size-5 shrink-0 text-lp-signal transition-transform group-open:rotate-45 motion-reduce:transition-none"
                  aria-hidden
                />
              </summary>
              <p className="pb-5 leading-relaxed text-lp-dim">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
