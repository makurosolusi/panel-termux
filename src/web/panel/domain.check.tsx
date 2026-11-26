import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { Domain } from "@/shared/panel.types";
import { Button } from "@/web/components/ui/button";
import { idPanel } from "@/web/i18n/id.panel";
import { ERROR_TOAST_MS } from "@/web/shared/api.action";
import { apiErrorMessage, apiFetch } from "@/web/shared/api.client";
import { panelUrl } from "./panel.api";

const t = idPanel.domains;

/** Server limit per hostname (PLAN/02 §3.7: 429 `too_soon` within 10 s). */
export const CHECK_COOLDOWN_MS = 10_000;

/** "Cek ulang": probes one hostname now, then stays disabled for the server's cooldown. */
export function DomainCheckButton({ hostname, onChecked }: { hostname: string; onChecked: () => void }) {
  const [pending, setPending] = useState(false);
  const [cooling, setCooling] = useState(false);

  useEffect(() => {
    if (!cooling) return;
    const h = setTimeout(() => setCooling(false), CHECK_COOLDOWN_MS); // one-shot re-enable, not polling
    return () => clearTimeout(h);
  }, [cooling]);

  const check = async () => {
    setPending(true);
    try {
      await apiFetch<Domain>("POST", panelUrl(`/domains/${encodeURIComponent(hostname)}/check`));
      toast.success(t.checked(hostname));
      onChecked();
    } catch (err) {
      toast.error(apiErrorMessage(err, idPanel.errorCodes), { duration: ERROR_TOAST_MS });
    } finally {
      setPending(false);
      setCooling(true);
    }
  };

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending || cooling}
      onClick={() => void check()}
      aria-label={t.checkLabel(hostname)}
    >
      {pending ? <Loader2Icon className="motion-safe:animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
      {t.check}
    </Button>
  );
}
