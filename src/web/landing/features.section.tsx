import { ActivityIcon, ArchiveIcon, LayersIcon, RocketIcon, ServerCogIcon, ShieldCheckIcon } from "lucide-react";
import { tLanding } from "@/web/i18n/en.landing";
import { LandingLegacyAnchor } from "./landing.anchors";
import { SectionHead } from "./section.head";

const t = tLanding.features;
const ICONS = [LayersIcon, RocketIcon, ActivityIcon, ServerCogIcon, ArchiveIcon, ShieldCheckIcon];
const [wizard, ...rest] = t.items;

/** Feature bento: the sites wizard as the wide lead card, the rest in a grid. */
export function FeaturesSection() {
  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="scroll-mt-16 border-y border-lp-line bg-lp-ink/[0.03] py-16 md:py-24"
    >
      <LandingLegacyAnchor of="features" />
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead id="features-title" kicker={t.kicker} title={t.title} />
        <ul className="mt-12 grid gap-4 md:grid-cols-3">
          <li className="relative overflow-hidden rounded-2xl bg-lp-screen p-6 text-white md:col-span-2 md:row-span-1 sm:p-8">
            <LayersIcon className="size-6 text-lp-signal-bright" aria-hidden />
            <h3 className="mt-5 font-lp-serif text-2xl font-semibold sm:text-3xl">{wizard.title}</h3>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">{wizard.body}</p>
            <ol className="mt-6 flex flex-wrap items-center gap-1.5 font-lp-mono text-xs">
              {"steps" in wizard &&
                wizard.steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span className="rounded-md border border-white/15 bg-white/5 px-2 py-1">
                      <span className="text-lp-led">✓</span> {s}
                    </span>
                    {i < wizard.steps.length - 1 && (
                      <span aria-hidden className="text-white/30">
                        →
                      </span>
                    )}
                  </li>
                ))}
            </ol>
          </li>
          {rest.map((f, i) => {
            const Icon = ICONS[i + 1] ?? LayersIcon;
            return (
              <li
                key={f.title}
                className="group rounded-2xl border border-lp-line bg-lp-paper p-6 transition-colors hover:border-lp-signal/60"
              >
                <Icon className="size-6 text-lp-signal" aria-hidden />
                <h3 className="mt-5 font-lp-serif text-xl font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-lp-dim">{f.body}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
