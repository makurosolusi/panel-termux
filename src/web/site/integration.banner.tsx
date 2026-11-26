import { AlertTriangleIcon } from "lucide-react";
import { Link } from "react-router";
import { hasRole } from "@/shared/roles";
import type { Integration } from "@/shared/site.types";
import { id } from "@/web/i18n/id";
import { panelUrl } from "@/web/panel/panel.api";
import { useMe } from "@/web/session/use-me";
import { useApiQuery } from "@/web/shared/use-api-query";
import { integrationHints } from "./site.adopt";

const t = id.site.integration;

/** Warning shown on the Site page while `/integration` reports issues; silent on load errors (list shows those). */
export function IntegrationBanner() {
  const { data } = useApiQuery<Integration>(panelUrl("/integration"));
  const me = useMe();
  if (!data || data.issues.length === 0) return null;
  const hints = integrationHints(data);
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200"
    >
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
        {t.title}
      </p>
      <ul className="ml-6 list-disc space-y-1">
        {hints.map((h) => (
          <li key={h}>
            {t[h]}
            {h === "token" && hasRole(me.role, "super_admin") && (
              <>
                {" "}
                <Link to="/dev/settings" className="font-medium underline">
                  {t.tokenLink}
                </Link>
              </>
            )}
          </li>
        ))}
      </ul>
      <details className="ml-6 text-xs">
        <summary className="cursor-pointer">{t.details}</summary>
        <ul className="mt-1 list-disc pl-4">
          {data.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
