import { cn } from "cn";
import { SearchIcon } from "lucide-react";
import { useId } from "react";
import { Input } from "@/web/components/ui/input";

/** List search box: `type="search"` with icon, visually hidden label, `Escape` clears. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const inputId = useId();
  return (
    <div className={cn("relative w-full sm:max-w-xs", className)}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={inputId}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        className="pl-8"
      />
    </div>
  );
}
