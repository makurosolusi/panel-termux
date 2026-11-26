import { idLanding } from "@/web/i18n/id.landing";
import { useDocumentTitle } from "@/web/layout/document.title";
import { ArchSection } from "./arch.section";
import { AccountDeletedNotice } from "./deleted.notice";
import { FaqSection } from "./faq.section";
import { FeaturesSection } from "./features.section";
import { FinalSection, LandingFooter } from "./final.section";
import { HeroSection } from "./hero.section";
import { InstallSection } from "./install.section";
import { LandingHeader } from "./landing.header";
import { LimitsSection } from "./limits.section";
import { ShotsSection } from "./shots.section";
import { StepsSection } from "./steps.section";
import { WhySection } from "./why.section";

/** `/`: public product page for people who want Panel Termux on their own phone (signed in or not). */
export function LandingPage() {
  useDocumentTitle(idLanding.meta.title, { raw: true });
  return (
    <div className="relative min-h-svh overflow-x-clip bg-lp-paper text-lp-ink selection:bg-lp-signal selection:text-lp-signal-ink">
      <div
        aria-hidden
        className="lp-grid pointer-events-none absolute inset-x-0 top-0 h-[900px] opacity-60 [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      <LandingHeader />
      <AccountDeletedNotice />
      <main className="relative">
        <HeroSection />
        <InstallSection />
        <ShotsSection />
        <WhySection />
        <FeaturesSection />
        <StepsSection />
        <ArchSection />
        <LimitsSection />
        <FaqSection />
        <FinalSection />
      </main>
      <LandingFooter />
    </div>
  );
}
