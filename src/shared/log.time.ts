// Timestamp parsing for runit `svlogd -tt` lines, e.g. "2026-11-26_13:54:24.23463 message" (UTC).

const SVLOGD_TT = /^(\d{4})-(\d{2})-(\d{2})_(\d{2}):(\d{2}):(\d{2})\.(\d{1,9}) /;

/** Splits a leading `svlogd -tt` timestamp (UTC) off a raw line; anything else → { at: null, text: raw }. */
export function splitLogTimestamp(raw: string): { at: string | null; text: string } {
  const m = SVLOGD_TT.exec(raw);
  if (!m) return { at: null, text: raw };
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const ms = Number((m[7] as string).padEnd(3, "0").slice(0, 3));
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
  // Date.UTC rolls invalid parts over (month 13 → next year); a round-trip mismatch means the stamp was invalid.
  const valid =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s;
  return valid ? { at: date.toISOString(), text: raw.slice(m[0].length) } : { at: null, text: raw };
}
