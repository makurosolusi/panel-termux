import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";
import { devErrorMessage, devFetch, devUrl } from "./dev.api";

/** Setting key whose row gets the "Tes token" button. */
export const CLOUDFLARE_TOKEN_KEY = "cloudflare.api_token";

const t = id.dev.settings;

/** Calls POST /api/dev/cloudflare/verify with the saved token and shows the verdict inline and as a toast. */
export function CloudflareVerifyButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const verify = async () => {
    setPending(true);
    try {
      const r = await devFetch<{ ok: boolean; message: string }>("POST", devUrl("/cloudflare/verify"));
      setResult(r);
      (r.ok ? toast.success : toast.error)(r.message);
    } catch (err) {
      const message = devErrorMessage(err);
      setResult({ ok: false, message });
      toast.error(message);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void verify()}>
        <ShieldCheckIcon aria-hidden />
        {pending ? t.verifying : t.verify}
      </Button>
      {result && (
        <span role="status" className={`text-xs ${result.ok ? "text-emerald-600" : "text-destructive"}`}>
          {result.message}
        </span>
      )}
    </div>
  );
}
