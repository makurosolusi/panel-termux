import { formatDateTime, formatRelative } from "@/web/shared/format";
import { useNow } from "./now.store";

/**
 * "3 mnt lalu" that keeps itself current on the shared clock (`useNow`); `absolute` shows the exact local time
 * instead (detail and history pages). Readers get the exact time (sr-only text; `aria-label` is not supported on `<time>`), pointers via `title`. `format`
 * wraps the visible text, e.g. `idCommon.updatedAgo` → "Diperbarui 3 mnt lalu".
 */
export function RelativeTime({
  at,
  absolute = false,
  format = (text) => text,
  className,
}: {
  at: string | Date;
  absolute?: boolean;
  format?: (text: string) => string;
  className?: string;
}) {
  const now = useNow();
  const iso = at instanceof Date ? at.toISOString() : at;
  const exact = formatDateTime(iso, true);
  const spoken = formatDateTime(iso);
  return (
    <time dateTime={iso} title={exact} className={className}>
      <span aria-hidden>{format(absolute ? exact : formatRelative(at, now))}</span>
      <span className="sr-only">{format(spoken)}</span>
    </time>
  );
}
