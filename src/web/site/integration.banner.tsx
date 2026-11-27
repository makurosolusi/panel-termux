import { TriangleAlertIcon } from "lucide-react";
import { Link } from "react-router";
import { tSite } from "@/web/i18n/en.site";

const t = tSite.setup;

/** Compact "pm2 belum siap" notice for the wizard; the full Persiapan card lives on /panel/sites. */
export function IntegrationBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-subtle px-3 py-2 text-sm"
    >
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <p>
        {t.notReady}{" "}
        <Link to="/panel/sites" className="font-medium underline underline-offset-2">
          {t.notReadyLink}
        </Link>
      </p>
    </div>
  );
}
