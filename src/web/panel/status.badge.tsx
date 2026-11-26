import { cn } from "cn";
import { Badge } from "@/web/components/ui/badge";
import type { Tone } from "./panel.status";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
  warn: "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "border-destructive/30 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

/** Small colored pill with a leading dot, e.g. "● Berjalan". */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1.5", TONE_CLASS[tone])}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </Badge>
  );
}
