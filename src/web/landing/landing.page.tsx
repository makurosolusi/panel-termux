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
