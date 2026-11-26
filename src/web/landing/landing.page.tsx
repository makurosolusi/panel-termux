import { id } from "@/web/i18n/id";
import { useDocumentTitle } from "@/web/layout/document.title";
import { ArchSection } from "./arch.section";
import { FaqSection } from "./faq.section";
import { FeaturesSection } from "./features.section";
import { FinalSection, LandingFooter } from "./final.section";
import { HeroSection } from "./hero.section";
import { LandingHeader } from "./landing.header";
import { StepsSection } from "./steps.section";
import { WhySection } from "./why.section";

/** `/`: public marketing page for panel-termux, shown to everyone (signed in or not). */
export function LandingPage() {
  // TODO(landing): use id.landing.meta.title once wkr-adm-landing-01 adds it (PLAN/05 §5, W5)
  useDocumentTitle(id.appName, { raw: true });
  return (
    <div className="relative min-h-svh overflow-x-clip bg-lp-paper text-lp-ink selection:bg-lp-signal selection:text-lp-signal-ink">
      <div
        aria-hidden
        className="lp-grid pointer-events-none absolute inset-x-0 top-0 h-[900px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      <LandingHeader />
      <main className="relative">
        <HeroSection />
        <WhySection />
        <FeaturesSection />
        <StepsSection />
        <ArchSection />
        <FaqSection />
        <FinalSection />
      </main>
      <LandingFooter />
    </div>
  );
}
