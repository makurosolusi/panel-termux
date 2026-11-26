import { ArrowRightIcon, RocketIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import type { DevSetup } from "@/shared/dev.types";
import { Button } from "@/web/components/ui/button";
import { idDevSetup } from "@/web/i18n/id.dev.setup";
import { useMe } from "@/web/session/use-me";
import { useApiQuery } from "@/web/shared/use-api-query";
import { bannerVisible, ONBOARDING_ANCHOR, SETUP_URL, saveDismissed, setupProgress } from "./onboarding.state";

const t = idDevSetup;

/**
 * Compact onboarding prompt for Ringkasan (PLAN/05 F1.2): "Siapkan Panel Termux: n dari total selesai" + Lanjutkan
 * (→ /dev) + hide. Renders nothing for non-super_admin (and never calls /api/dev/* for them), when dismissed or complete.
 */
export function OnboardingBanner() {
  const isSuper = useMe().role === "super_admin";
  const query = useApiQuery<DevSetup>(SETUP_URL, undefined, { enabled: isSuper, initial: isSuper });
  const [busy, setBusy] = useState(false);
  const setup = query.data;
  if (!isSuper || !setup || !bannerVisible(setup)) return null;
  const { done, total } = setupProgress(setup);

  const hide = async () => {
    setBusy(true);
    await saveDismissed(true);
    setBusy(false);
    query.reload();
  };

  return (
    <aside
      aria-label={t.title}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-brand-text/20 bg-brand-subtle px-4 py-2.5 text-sm"
    >
      <RocketIcon className="size-4 shrink-0 text-brand-text" aria-hidden />
      <p className="min-w-0 flex-1 font-medium">{t.banner.title(done, total)}</p>
      <div className="flex items-center gap-1">
        <Button size="sm" asChild>
          <Link to={`/dev#${ONBOARDING_ANCHOR}`}>
            {t.banner.continue}
            <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void hide()}
          disabled={busy}
          aria-label={t.hide}
          title={t.hide}
        >
          <XIcon aria-hidden />
        </Button>
      </div>
    </aside>
  );
}
