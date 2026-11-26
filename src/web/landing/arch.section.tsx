import { CloudIcon, GlobeIcon, SmartphoneIcon, WaypointsIcon } from "lucide-react";
import { Fragment } from "react";
import { idLanding } from "@/web/i18n/id.landing";
import { SectionHead } from "./section.head";

const t = idLanding.arch;
const ICONS = [SmartphoneIcon, WaypointsIcon, CloudIcon, GlobeIcon];

/** Architecture: phone → cloudflared → Cloudflare → internet, with animated SVG connectors. */
export function ArchSection() {
  return (
    <section aria-labelledby="arch-title" className="bg-lp-screen py-16 text-white md:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead id="arch-title" kicker={t.kicker} title={t.title} onDark />
        <p className="mt-5 max-w-2xl leading-relaxed text-white/65">{t.lead}</p>
        <figure className="mt-12">
          <ol aria-label={t.label} className="flex flex-col items-stretch md:flex-row md:items-center">
            {t.nodes.map((n, i) => {
              const Icon = ICONS[i] ?? GlobeIcon;
              const first = i === 0;
              return (
                <Fragment key={n.title}>
                  {i > 0 && <Connector />}
                  <li
                    className={`flex flex-1 items-center gap-4 rounded-2xl border p-4 md:flex-col md:items-start md:p-5 ${first ? "border-lp-signal-bright bg-lp-signal-bright/10" : "border-white/15 bg-white/[0.04]"}`}
                  >
                    <Icon
                      className={`size-7 shrink-0 ${first ? "text-lp-signal-bright" : "text-white/80"}`}
                      aria-hidden
                    />
                    <div>
                      <div className="font-lp-serif text-lg font-semibold">{n.title}</div>
                      <div className="mt-0.5 font-lp-mono text-[11px] leading-snug text-white/55">{n.detail}</div>
                    </div>
                  </li>
                </Fragment>
              );
            })}
          </ol>
        </figure>
      </div>
    </section>
  );
}

/** Dashed, flowing link between two nodes; vertical on phones, horizontal from md up. */
function Connector() {
  return (
    <li aria-hidden className="flex h-10 items-center justify-center md:h-auto md:w-14">
      <svg aria-hidden="true" viewBox="0 0 56 16" className="h-4 w-14 rotate-90 md:rotate-0">
        <path d="M2 8 H48" stroke="var(--lp-signal-bright)" strokeWidth="2" strokeDasharray="5 7" className="lp-flow" />
        <path
          d="M46 3 L53 8 L46 13"
          fill="none"
          stroke="var(--lp-signal-bright)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </li>
  );
}
