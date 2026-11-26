import type { DevHealth, HealthStatus, PanelCheck } from "@/shared/dev.types";
import type { Problem } from "@/shared/panel.types";
import type { StatusKey } from "@/web/components/status.vocab";
import { idDevHealth } from "@/web/i18n/id.dev.health";
import { formatRelative } from "@/web/shared/format";

// Pure decisions of /dev Kesehatan sistem (PLAN/05 §3.4, F2): verdict, check rows, info rows. Status keys per B12.

const t = idDevHealth;

/** Verdict → canonical status key (badge tone); the label comes from `id.dev.health.verdict`. */
export const HEALTH_STATUS_KEY: Readonly<Record<HealthStatus, StatusKey>> = {
  ok: "healthy",
  warn: "attention",
  fail: "errored",
};

/** Problem severity (non-info) → canonical status key. */
export const PROBLEM_STATUS_KEY = { warning: "attention", danger: "errored" } as const satisfies Record<
  string,
  StatusKey
>;

/** Codes that never lower the verdict (B4); used only while the server omits `infoCodes`. */
export const DEFAULT_INFO_CODES: readonly string[] = ["backup_not_configured", "access_not_seen"];

/** Used-disk percentage at which the Penyimpanan bar turns warning / danger (server DISK_*_RATIO: 10% / 5% free). */
export const DISK_THRESHOLDS = { warn: 90, danger: 95 } as const;

const RANK: Record<HealthStatus, number> = { ok: 0, warn: 1, fail: 2 };
const worst = (all: HealthStatus[]): HealthStatus =>
  all.reduce<HealthStatus>((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");

const infoCodesOf = (h: DevHealth): readonly string[] => h.infoCodes ?? DEFAULT_INFO_CODES;
const isInfo = (h: DevHealth, p: Problem): boolean => p.severity === "info" || infoCodesOf(h).includes(p.code ?? "");
const problemStatus = (p: Problem): HealthStatus => (p.severity === "danger" ? "fail" : "warn");

/** Problems that count for the verdict (info codes and severity info removed), worst first. */
export const verdictProblems = (h: DevHealth): Problem[] =>
  (h.problems ?? []).filter((p) => !isInfo(h, p)).sort((a, b) => RANK[problemStatus(b)] - RANK[problemStatus(a)]);

/** Info rows ("Informasi"): codes present in problems that do not count, de-duplicated, in server order. */
export const infoRows = (h: DevHealth): string[] => [
  ...new Set((h.problems ?? []).filter((p) => isInfo(h, p) && p.code).map((p) => p.code as string)),
];

/** Server verdict, or the same rule (worst of counted problems + checks) while the field is optional. */
export const verdictOf = (h: DevHealth): HealthStatus =>
  h.verdict ?? worst([...verdictProblems(h).map(problemStatus), ...(h.checks ?? []).map((c) => c.status)]);

/** Panel checks, worst first (stable for equal status). */
export const sortedChecks = (h: DevHealth): PanelCheck[] =>
  [...(h.checks ?? [])].sort((a, b) => RANK[b.status] - RANK[a.status]);

/** One check as a row: sentence and optional link. */
export type CheckRow = { key: PanelCheck["key"]; status: HealthStatus; text: string; href?: string };

/** Sentence (+ link) of one panel check; times are relative to `now`. "Waiting" rows never lower the status. */
export function checkRow(c: PanelCheck, h: DevHealth, now: Date): CheckRow {
  const n = typeof c.value === "number" ? c.value : 0;
  switch (c.key) {
    case "errors":
      return {
        key: c.key,
        status: c.status,
        text: c.status === "ok" ? t.checks.errors.ok : t.checks.errors[c.status](n),
        href: c.status === "ok" ? undefined : "/dev/logs?level=error",
      };
    case "sampler": {
      const at = h.sampledAt ?? null;
      if (at === null) return { key: c.key, status: "ok", text: t.checks.sampler.waiting };
      return {
        key: c.key,
        status: c.status,
        text: t.checks.sampler[c.status === "ok" ? "ok" : "warn"](formatRelative(at, now)),
      };
    }
    case "backup_scheduler": {
      const at = h.backupTickAt ?? null;
      if (at === null) return { key: c.key, status: c.status, text: t.checks.backup_scheduler.waiting };
      const text = t.checks.backup_scheduler[c.status === "ok" ? "ok" : "warn"](formatRelative(at, now));
      return { key: c.key, status: c.status, text };
    }
    default:
      return { key: c.key, status: c.status, text: t.checks.fake_on_https[c.status === "ok" ? "ok" : "fail"] };
  }
}

/** Headline under the verdict: worst counted problem, else worst failing check, else the all-clear sentence. */
export function verdictSentence(h: DevHealth, now: Date, problemTitle: (p: Problem) => string): string {
  const [p] = verdictProblems(h);
  const [c] = sortedChecks(h);
  if (p && (!c || RANK[problemStatus(p)] >= RANK[c.status])) return problemTitle(p);
  if (c && c.status !== "ok") return checkRow(c, h, now).text;
  return t.verdictOk;
}

/** Info copy for a code, or null for a code this page has no sentence for. */
export const infoText = (code: string): string | null =>
  code === "backup_not_configured" || code === "access_not_seen" ? t.info[code] : null;
