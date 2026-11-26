import type { ReactNode } from "react";
import { Label } from "@/web/components/ui/label";

/** Label + control + hint + error messages (errors announced to screen readers via `id-errors`). */
export function FormField({
  id,
  label,
  hint,
  errors,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  errors?: readonly string[];
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors && errors.length > 0 && (
        <ul id={`${id}-errors`} className="text-xs text-destructive" aria-live="polite">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
