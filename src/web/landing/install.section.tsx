import { CheckIcon, ExternalLinkIcon } from "lucide-react";
import { CopyButton } from "@/web/components/copy-button";
import { idLanding } from "@/web/i18n/id.landing";
import { SectionHead } from "./section.head";

const t = idLanding.install;
const links = idLanding.links;
const LINK =
  "inline-flex min-h-11 items-center gap-1.5 rounded font-lp-mono text-xs font-semibold underline decoration-lp-signal decoration-2 underline-offset-4 hover:text-lp-signal focus-visible:outline-2 focus-visible:outline-lp-signal";

/** `#pasang`: honest prerequisites and the four install steps, with the copyable one-line install (PLAN/07 K24). */
export function InstallSection() {
  return (
    <section
      id="pasang"
      aria-labelledby="install-title"
      className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6 md:py-24"
    >
      <SectionHead id="install-title" kicker={t.kicker} title={t.title} />
      <p className="mt-5 max-w-2xl leading-relaxed text-lp-dim">{t.lead}</p>
      <div className="mt-12 grid gap-12 md:grid-cols-[0.85fr_1.15fr]">
        <div>
          <h3 className="font-lp-mono text-xs tracking-wider text-lp-dim uppercase">{t.prereqTitle}</h3>
          <ul className="mt-4 divide-y divide-lp-line border-y border-lp-line">
            {t.prereqs.map((p) => (
              <li key={p} className="flex gap-3 py-3 text-sm leading-relaxed">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-lp-signal" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-lp-mono text-xs tracking-wider text-lp-dim uppercase">{t.stepsTitle}</h3>
          <ol className="mt-4 space-y-8">
            {t.steps.map((s, i) => (
              <li key={s.title} className="grid grid-cols-[2rem_1fr] gap-x-3">
                <span aria-hidden className="font-lp-serif text-3xl leading-none font-semibold text-lp-signal">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h4 className="font-lp-serif text-xl font-semibold">{s.title}</h4>
                  <p className="mt-1.5 text-sm leading-relaxed text-lp-dim">{s.body}</p>
                  {i === 0 ? <InstallCommand /> : "code" in s && <Code text={s.code} />}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 border-t border-lp-line pt-4">
            <a className={LINK} href={links.readmeInstall} rel="noreferrer">
              {t.readme}
              <ExternalLinkIcon className="size-3.5" aria-hidden />
            </a>
            <span className="font-lp-mono text-xs text-lp-dim">{t.upgrade}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Step 1: the install line with copy, checksum note and the releases link. */
function InstallCommand() {
  return (
    <div className="mt-4">
      <div className="flex items-start gap-2 rounded-lg bg-lp-screen py-2.5 pr-2 pl-3 text-white/85">
        <pre className="min-w-0 flex-1 py-1 font-lp-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          <span aria-hidden className="text-lp-signal-bright">
            ${" "}
          </span>
          <code>{t.command}</code>
        </pre>
        <CopyButton value={t.command} label={t.copy} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 text-xs text-lp-dim">
        <span>{t.checksum}</span>
        <a className={LINK} href={links.releases} rel="noreferrer">
          {t.viewReleases}
        </a>
      </p>
    </div>
  );
}

function Code({ text }: { text: string }) {
  return (
    <code className="mt-3 block rounded-lg bg-lp-screen px-3 py-2.5 font-lp-mono text-[11px] [overflow-wrap:anywhere] text-white/85">
      <span aria-hidden className="text-lp-signal-bright">
        ${" "}
      </span>
      {text}
    </code>
  );
}
