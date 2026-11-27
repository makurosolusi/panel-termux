import { Loader2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import type { FixKey, FixPreview } from "@/shared/fix.types";
import { CodeText } from "@/web/components/code-text";
import { Button } from "@/web/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/web/components/ui/dialog";
import { idSite } from "@/web/i18n/id.site";
import { useReturnFocus } from "@/web/shared/focus.return";
import { PHONE_SHEET } from "./adopt.dialog";
import { FixDiff } from "./fix.diff";
import { fixSummary } from "./site.adopt";
import { applyFixes, fixErrorMessage, previewFix, toastFixRun } from "./site.api";

const t = idSite.setup.dialog;

/** Dialog title: the fix's own question, or "Perbaiki n hal sekaligus?" for several. */
export const fixDialogTitle = (keys: readonly FixKey[]): string =>
  keys.length === 1 && keys[0] ? t[keys[0]].title : idSite.setup.dialogAll.title(keys.length);

/**
 * Preview of one or more fixes (PLAN/06 §4.1): plain summary first, the exact file diff folded under "Lihat perubahan
 * pada file". Terapkan applies them one by one and stops at the first failure. `keys` null = closed. Loaded lazily.
 */
export function FixDialog({
  keys,
  onClose,
  onDone,
}: {
  keys: FixKey[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const returnFocus = useReturnFocus(keys !== null);
  const [applying, setApplying] = useState(false);
  return (
    <Dialog open={keys !== null} onOpenChange={(open) => !open && !applying && onClose()}>
      <DialogContent className={PHONE_SHEET} onCloseAutoFocus={returnFocus}>
        {keys && (
          <FixBody
            key={keys.join()}
            keys={keys}
            applying={applying}
            setApplying={setApplying}
            onDone={() => {
              onDone();
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
  applying,
  setApplying,
  onDone,
}: {
  keys: FixKey[];
  applying: boolean;
  setApplying: (v: boolean) => void;
  onDone: () => void;
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
    onDone();
  };
  const files = previews?.flatMap((p) => p.files) ?? [];

  return (
    <>
      <DialogHeader>
        <DialogTitle>{fixDialogTitle(keys)}</DialogTitle>
        <DialogDescription className="sr-only">{t.showDiff}</DialogDescription>
      </DialogHeader>
      {!previews && !error && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-4 motion-safe:animate-spin" aria-hidden />
          {t.loading}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md border border-danger/25 bg-danger-subtle p-3 text-sm">
          <CodeText>{error}</CodeText>
        </p>
      )}
      {previews && (
        <div className="flex min-w-0 flex-col gap-3 text-sm">
          {previews.map((p) => (
            <div key={p.key} className="flex flex-col gap-1.5">
              {previews.length > 1 && <h3 className="font-semibold">{t[p.key].title}</h3>}
              {fixSummary(p).map((line) => (
                <p key={line}>
                  <CodeText>{line}</CodeText>
                </p>
              ))}
            </div>
          ))}
          {files.length > 0 && (
            <>
              <p className="text-muted-foreground">{t.backupNote}</p>
              <details className="group flex flex-col gap-2">
                <summary className="cursor-pointer font-medium underline-offset-2 hover:underline">
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
      <DialogFooter>
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
