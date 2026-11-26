import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/web/components/ui/button";
import { id } from "@/web/i18n/id";

const t = id.shell.copy;
const RESET_MS = 1_500;

/** Icon button that copies `value` to the clipboard and confirms with a check (announced to screen readers). */
export function CopyButton({ value, label = t.copy }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => setState("copied"),
      () => setState("failed"), // clipboard denied (insecure origin / permission): tell the user, nothing to retry
    );
  return (
    <Button type="button" variant="ghost" size="icon-xs" onClick={() => void copy()} aria-label={label} title={label}>
      {state === "copied" ? <CheckIcon className="text-success" aria-hidden /> : <CopyIcon aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? t.copied : state === "failed" ? t.failed : ""}
      </span>
    </Button>
  );
}
