import { BatteryFullIcon, CloudIcon, CpuIcon, LeafIcon } from "lucide-react";
import { tLanding } from "@/web/i18n/en.landing";
import { SectionHead } from "./section.head";

const t = tLanding.why;
const ICONS = [BatteryFullIcon, LeafIcon, CloudIcon, CpuIcon];

/** "Kenapa HP bekas": four value props laid out like a spec sheet. */
export function WhySection() {
  return (
    <section aria-labelledby="why-title" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
      <SectionHead id="why-title" kicker={t.kicker} title={t.title} />
      <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-lp-line bg-lp-line sm:grid-cols-2 lg:grid-cols-4">
        {t.items.map((item, i) => {
          const Icon = ICONS[i] ?? CpuIcon;
          return (
            <li key={item.title} className="bg-lp-paper p-6">
              <div className="flex items-center justify-between">
                <Icon className="size-6 text-lp-signal" aria-hidden />
                <span aria-hidden className="font-lp-mono text-xs text-lp-dim">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-6 font-lp-serif text-xl font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-lp-dim">{item.body}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
