import type { ReactNode } from "react";
import { Section } from "@/web/components/section";
import { tSiteDetail } from "@/web/i18n/en.site-detail";

const t = tSiteDetail.anchors;

/** Section ids of the site detail, in page order (`#deploy` is the Deploy button's target). */
export const SITE_ANCHORS = [
  { id: "ringkasan", label: t.summary },
  { id: "deploy", label: t.deploy },
  { id: "domains", label: t.domains },
  { id: "env", label: t.env },
  { id: "settings", label: t.settings },
] as const;

/** Anchor id of a detail section. */
export type SiteAnchorId = (typeof SITE_ANCHORS)[number]["id"];

/** Jump chips to the page sections (not tabs: every section stays on the page). Sticky under the top bar on phones. */
export function SiteAnchors() {
  return (
    <nav
      aria-label={t.label}
      className="sticky top-[calc(3rem+env(safe-area-inset-top))] z-20 -mx-4 border-b bg-background/95 px-4 py-2 backdrop-blur md:top-14 md:mx-0 md:px-0"
    >
      <ul className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        {SITE_ANCHORS.map((a) => (
          <li key={a.id} className="shrink-0">
            <a
              href={`#${a.id}`}
              className="inline-flex h-8 items-center rounded-full border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:h-11"
            >
              {a.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A detail section that the anchor chips can scroll to (offset below the sticky bars). */
export function AnchorSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: SiteAnchorId;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-32 md:scroll-mt-28">
      <Section title={title} description={description} action={action}>
        {children}
      </Section>
    </div>
  );
}
