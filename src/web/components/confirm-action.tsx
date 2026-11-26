import { Loader2Icon } from "lucide-react";
import { type ReactElement, type ReactNode, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { CodeText } from "@/web/components/code-text";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/web/components/ui/alert-dialog";
import { Button } from "@/web/components/ui/button";
import { Input } from "@/web/components/ui/input";
import { idCommon } from "@/web/i18n/id.common";
import { idShell } from "@/web/i18n/id.shell";
import { apiErrorMessage, type ErrorCodes } from "@/web/shared/api.client";

const t = idShell.confirm;

type ConfirmBase = {
  /** The question: "Hapus situs blog?" */
  title: string;
  /** Consequence first, then what stays safe. */
  description: ReactNode;
  /** Verb + object, same verb as the title: "Hapus situs blog". */
  confirmLabel: string;
  destructive?: boolean;
  codes?: ErrorCodes;
  /** Receives the trimmed typed value (tier typed) for `?confirm=` / `ControlBody.confirm`. Reject = stay open + inline error. */
  onConfirm: (typed?: string) => Promise<unknown>;
  /** "Situs blog dihapus." */
  successToast?: string;
  /** Omitted when the dialog is opened from a "⋯" menu (then use `open`/`onOpenChange`). */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/** Props of ConfirmAction: tier `confirm` (AlertDialog) or `typed` (type `typedValue` exactly to enable the button). */
export type ConfirmActionProps =
  | (ConfirmBase & { tier?: "confirm" })
  | (ConfirmBase & { tier: "typed"; typedValue: string });

/** Exact match after trimming outer whitespace; case-sensitive. */
export const typedMatches = (input: string, expected: string): boolean => input.trim() === expected;

/**
 * Confirmation for risky actions (PLAN/01 §3.2). The confirm button is a plain Button (not radix's action button, which
 * would close before the request settles): while pending nothing closes the dialog, errors stay inside it, and it
 * closes only after `onConfirm` resolves.
 */
export function ConfirmAction(props: ConfirmActionProps) {
  const { title, description, confirmLabel, destructive, codes, onConfirm, successToast, trigger } = props;
  const typedValue = props.tier === "typed" ? props.typedValue : null;
  const [innerOpen, setInnerOpen] = useState(false);
  const open = props.open ?? innerOpen;
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false); // state updates are async; a ref stops a double tap from confirming twice
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  const setOpen = (next: boolean) => {
    if (inFlight.current) return; // Escape / Cancel / overlay are ignored while the request runs
    if (!next) {
      setTyped("");
      setError(null);
    }
    setInnerOpen(next);
    props.onOpenChange?.(next);
  };

  const canConfirm = typedValue === null || typedMatches(typed, typedValue);

  const confirm = async () => {
    if (inFlight.current || !canConfirm) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm(typedValue === null ? undefined : typed.trim());
    } catch (err) {
      setError(apiErrorMessage(err, codes)); // shown in the dialog; the typed value is kept for another try
      return;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    setOpen(false);
    if (successToast) toast.success(successToast);
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent
        onOpenAutoFocus={(e) => {
          if (typedValue === null) return; // confirm tier: radix focuses Batal (safe default)
          e.preventDefault(); // typed tier: the next step is typing, so focus the input
          inputRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          if (inFlight.current) e.preventDefault();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <CodeText>{description}</CodeText>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p
            id={errorId}
            role="alert"
            className="rounded-md border border-danger/25 bg-danger-subtle px-3 py-2 text-sm"
          >
            <CodeText>{error}</CodeText>
          </p>
        )}
        {typedValue !== null && (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void confirm();
            }}
          >
            <label htmlFor={inputId} className="text-sm font-medium">
              <TypedLabel value={typedValue} />
            </label>
            <Input
              ref={inputRef}
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={pending}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono"
              aria-describedby={error ? errorId : undefined}
            />
            <p className="text-xs text-muted-foreground">{t.typedHint}</p>
          </form>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{idCommon.cancel}</AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending || !canConfirm}
            aria-busy={pending || undefined}
            onClick={() => void confirm()}
          >
            {pending && <Loader2Icon className="motion-safe:animate-spin" aria-hidden />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** "Ketik <code>blog</code> untuk konfirmasi": the i18n sentence with the value rendered as code. */
function TypedLabel({ value }: { value: string }) {
  const text = t.typedLabel(value);
  const at = text.indexOf(value);
  return (
    <>
      {text.slice(0, at)}
      <code className="rounded bg-muted px-1 font-mono">{value}</code>
      {text.slice(at + value.length)}
    </>
  );
}
