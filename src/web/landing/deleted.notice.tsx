import { CircleCheckIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { tLanding } from "@/web/i18n/en.landing";
import { isAccountDeletedSearch } from "./account.deleted";

const t = tLanding.accountDeleted;

/** One-time confirmation after self-delete; drops the `?account=deleted` marker from the URL so a reload does not repeat it. */
export function AccountDeletedNotice() {
  const [open, setOpen] = useState(() => isAccountDeletedSearch(window.location.search));
  useEffect(() => {
    if (open) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.hash);
  }, [open]);
  if (!open) return null;
  return (
    <div role="status" className="relative mx-auto mt-4 max-w-6xl px-4 sm:px-6">
      <div className="flex items-start gap-3 rounded-2xl border border-lp-line bg-lp-paper p-4 shadow-sm">
        <CircleCheckIcon className="mt-0.5 size-5 shrink-0 text-lp-signal" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t.title}</p>
          <p className="mt-1 text-sm text-lp-dim">{t.body}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t.close}
          className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-lp-line focus-visible:outline-2 focus-visible:outline-lp-signal"
        >
          <XIcon className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
