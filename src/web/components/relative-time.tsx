import { useEffect, useState } from "react";
import { formatDateTime, formatRelative } from "@/web/shared/format";

/** Re-render tick for relative times; one interval per mounted element is cheap at this scale. */
const TICK_MS = 5_000;

/**
 * "3 mnt lalu" that keeps itself current; the exact local time is in the tooltip and `dateTime`. `format` wraps
 * the relative text, e.g. `id.common.updatedAgo` → "Diperbarui 3 mnt lalu".
 */
export function RelativeTime({
  at,
  format = (rel) => rel,
  className,
}: {
  at: string | Date;
  format?: (rel: string) => string;
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const iso = at instanceof Date ? at.toISOString() : at;
  return (
    <time dateTime={iso} title={formatDateTime(iso, true)} className={className}>
      {format(formatRelative(at, now))}
    </time>
  );
}
