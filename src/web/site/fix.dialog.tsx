import { Loader2Icon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FixKey, FixPreview } from "@/shared/fix.types";
import { CodeText } from "@/web/components/code-text";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { tSite } from "@/web/i18n/en.site";
import { useDoneFocus } from "@/web/shared/focus.return";
import { PHONE_SHEET } from "./adopt.dialog";
import { FixDiff } from "./fix.diff";
import { fixSummary, previewTitle, restartNeeded } from "./site.adopt";
import { applyFixes, fixErrorMessage, previewFix, toastFixRun } from "./site.api";

const t = tSite.setup.dialog;

/** Dialog title: the fix's own question, or "Fix n items at once?" for several. */
export const fixDialogTitle = (keys: readonly FixKey[]): string =>
  keys.length === 1 && keys[0] ? t[keys[0]].title : tSite.setup.dialogAll.title(keys.length);

/** Footer that stays at the bottom of the scrolling sheet while the diff is open (QA fix-04 MINOR-1). */
const STICKY_FOOTER =
  "sticky bottom-0 -mx-6 -mb-6 border-t bg-background px-6 py-4 max-sm:-mb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]";

/**
 * Preview of one or more fixes (PLAN/06 §4.1): plain summary first, the exact file diff folded under "Lihat perubahan
 * pada file". Terapkan applies them one by one and stops at the first failure. `keys` null = closed. Loaded lazily.
 * After Apply focus goes to `focusAfter()` (the Fix button is gone by then). `onDone(restart)`: an applied fix
 * takes effect only when pm2 starts again.
 */
export function FixDialog({
  keys,
  onClose,
  onDone,
  focusAfter,
}: {
  keys: FixKey[] | null;
  onClose: () => void;
  onDone: (restart: boolean) => void;
  focusAfter?: () => HTMLElement | null;
}) {
  const focus = useDoneFocus(keys !== null, focusAfter);
  const [applying, setApplying] = useState(false);
  const descId = useId();
  return (
    <Dialog open={keys !== null} onOpenChange={(open) => !open && !applying && onClose()}>
      <DialogContent className={PHONE_SHEET} onCloseAutoFocus={focus.onCloseAutoFocus} aria-describedby={descId}>
        {keys && (
          <FixBody
            key={keys.join()}
            keys={keys}
            descId={descId}
            applying={applying}
            setApplying={setApplying}
            onDone={(applied, restart) => {
              if (applied) focus.markDone(); // on an error the Fix button is still there: back to it
              onDone(restart);
              onClose();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FixBody({
  keys,
  descId,
  applying,
  setApplying,
  onDone,
}: {
  keys: FixKey[];
  /** The dialog's description: the plain summary (or the loading / error line until it is there). */
  descId: string;
  applying: boolean;
  setApplying: (v: boolean) => void;
  onDone: (applied: boolean, restart: boolean) => void;
}) {
  const [previews, setPreviews] = useState<FixPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the body is keyed by `keys`, so it loads once per set
  useEffect(() => {
    let live = true;
    Promise.all(keys.map(previewFix)).then(
      (p) => live && setPreviews(p),
      (err: unknown) => live && setError(fixErrorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, []);

  const apply = async () => {
    if (!previews) return;
    setApplying(true);
    const run = await applyFixes(previews);
    setApplying(false);
    toastFixRun(run);
    onDone(run.error === null, restartNeeded(previews, run.done));
  };
  const files = previews?.flatMap((p) => p.files) ?? [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {previews?.length === 1 && previews[0] ? previewTitle(previews[0]) : fixDialogTitle(keys)}
        </DialogTitle>
      </DialogHeader>
      {!previews && !error && (
        <p id={descId} role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden />
          {t.loading}
        </p>
      )}
      {error && (
        <p id={descId} role="alert" className="rounded-md border border-danger/25 bg-danger-subtle p-3 text-sm">
          <CodeText>{error}</CodeText>
        </p>
      )}
      {previews && (
        <div className="flex min-w-0 flex-col gap-3 text-sm">
          <div id={descId} className="flex flex-col gap-3">
            {previews.map((p) => (
              <div key={p.key} className="flex flex-col gap-1.5">
                {previews.length > 1 && <h3 className="font-semibold">{previewTitle(p)}</h3>}
                {fixSummary(p).map((line) => (
                  <p key={line}>
                    <CodeText>{line}</CodeText>
                  </p>
                ))}
              </div>
            ))}
          </div>
          {files.length > 0 && (
            <>
              <p className="text-muted-foreground">{t.backupNote}</p>
              <details className="group flex flex-col gap-2">
                <summary className="cursor-pointer font-medium underline-offset-2 hover:underline pointer-coarse:py-3">
                  {t.showDiff}
                </summary>
                <div className="mt-2 flex flex-col gap-3">
                  {files.map((f) => (
                    <FixDiff key={f.path} file={f} />
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      )}
      <DialogFooter className={STICKY_FOOTER}>
        <DialogClose asChild>
          <Button variant="outline" disabled={applying}>
            {t.cancel}
          </Button>
        </DialogClose>
        <Button onClick={() => void apply()} disabled={!previews || applying}>
          {applying && <Loader2Icon className="motion-safe:animate-spin" aria-hidden />}
          {applying ? t.applying : t.apply}
        </Button>
      </DialogFooter>
    </>
  );
}
