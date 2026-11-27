// Readers of a Problem's params shared by the English and Indonesian problem copy (one parsing rule, two languages).

/** A finite number param, else null. */
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A param as text; null/undefined read as "". */
export const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
