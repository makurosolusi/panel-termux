// Audit filters from the query string and the CSV export (PLAN/05 §3.3, G28/A8).
import type { DevAuditEntry } from "../../shared/dev.types";
import { type AuditFilter, listAudit, recordAudit } from "../audit.service";
import type { Db } from "../db/client";
import { ApiError } from "../routes/http.error";

/** Newest rows an export holds at most. */
export const EXPORT_MAX_ROWS = 10_000;
const EXPORT_PAGE = 500;
/** Fixed CSV header (no raw `meta`: it may hold detail nobody should mail around). */
export const CSV_HEADER = ["waktu", "aktor", "email_aktor", "aksi", "target", "ip_tersamar", "request_id"];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local midnight of `YYYY-MM-DD` (+`addDays`); 400 `invalid_date` for anything else, e.g. 2026-02-30. */
function localMidnight(name: string, raw: string, addDays = 0): Date {
  const m = DATE_RE.exec(raw);
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
  const date = new Date(y, mo - 1, d);
  if (!m || date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d)
    throw new ApiError(400, "invalid_date", `${name} must be a date YYYY-MM-DD`);
  date.setDate(date.getDate() + addDays);
  return date;
}

/**
 * Audit filter from `?action=a&action=b.&actorId&from&to` (action repeatable; a trailing `.` = prefix).
 * `from` is inclusive from local midnight, `to` includes that whole day (exclusive next local midnight).
 */
export function parseAuditFilter(params: URLSearchParams): AuditFilter {
  const from = params.get("from");
  const to = params.get("to");
  return {
    action: params.getAll("action").filter(Boolean),
    actorId: params.get("actorId") || undefined,
    from: from ? localMidnight("from", from) : undefined,
    to: to ? localMidnight("to", to, 1) : undefined,
  };
}

// Spreadsheets run cells starting with these as formulas (CSV injection); a leading ' keeps them text.
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell: formula-safe, always quoted, inner quotes doubled. */
export const csvCell = (v: string | null | undefined): string => {
  const s = v ?? "";
  return `"${(FORMULA_START.test(s) ? `'${s}` : s).replaceAll('"', '""')}"`;
};

const csvRow = (e: DevAuditEntry) =>
  [e.at, e.actorLabel ?? e.actorKind ?? "", e.actorEmail, e.action, e.target, e.ipMasked, e.requestId]
    .map(csvCell)
    .join(",");

const pad = (n: number) => String(n).padStart(2, "0");
/** `audit-<yyyymmdd>.csv` in local time. */
export const exportFileName = (d: Date) => `audit-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;

/**
 * GET /api/dev/audit/export.csv: up to EXPORT_MAX_ROWS newest matching rows, read and streamed 500 at a time.
 * The window ends at the start of the request's second (audit_log.at has second resolution), so rows written
 * while streaming, this export's own `audit.export` among them, never shift the pages. Audited with filter + count.
 */
export function exportAuditCsv(db: Db, actorId: string, filter: AuditFilter, now = new Date()): Response {
  const end = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const window: AuditFilter = { ...filter, to: filter.to && filter.to < end ? filter.to : end };
  const page = (n: number) =>
    listAudit(db, { page: n, pageSize: EXPORT_PAGE, offset: (n - 1) * EXPORT_PAGE }, window).items;
  const first = listAudit(db, { page: 1, pageSize: 1, offset: 0 }, window);
  const rows = Math.min(first.total, EXPORT_MAX_ROWS);
  recordAudit(db, {
    actorId,
    action: "audit.export",
    meta: {
      rows,
      action: filter.action ?? [],
      actorId: filter.actorId ?? null,
      from: filter.from?.toISOString() ?? null,
      to: filter.to?.toISOString() ?? null,
    },
  });
  let sent = 0;
  let next = 1;
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`${CSV_HEADER.join(",")}\r\n`));
    },
    pull(c) {
      const items = sent < rows ? page(next++).slice(0, rows - sent) : [];
      if (items.length === 0) return c.close();
      sent += items.length;
      c.enqueue(enc.encode(items.map((e) => `${csvRow(e)}\r\n`).join("")));
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFileName(now)}"`,
      "cache-control": "no-store",
    },
  });
}
