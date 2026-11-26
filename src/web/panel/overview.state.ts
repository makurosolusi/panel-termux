// Ringkasan decisions (PLAN/02 §5.1), pure so they are unit-tested: problem split, count badges, battery and load.
import type { LoadBaseline, OverviewSection, Problem, ProblemKind } from "@/shared/monitor.types";
import type { App, Battery, Domain } from "@/shared/panel.types";
import type { StatusTone } from "@/web/components/status.tone";
import { idOverview } from "@/web/i18n/id.overview";
import { formatDuration, formatNumber } from "@/web/shared/format";

const t = idOverview;

/**
 * Problem rows shown before "Tampilkan N lainnya": 3 on a phone so the strip + 4 tiles fit above the fold at 390×844
 * (PLAN/02 §6 acceptance wins over the §5.1 "maks 5"), 5 on wider screens so a long list never buries the tiles.
 */
export const PHONE_PROBLEM_ROWS = 3;
export const DESKTOP_PROBLEM_ROWS = 5;

/** Rows hidden behind "Tampilkan N lainnya" for a viewport's cap (0 once expanded). */
export const hiddenProblems = (count: number, cap: number, expanded: boolean): number =>
  expanded ? 0 : Math.max(0, count - cap);

/** Load5 above this many times the usual median is warning / danger (K6, display only). */
export const LOAD_WARN_RATIO = 1.5;
export const LOAD_DANGER_RATIO = 2;

/** Warning/danger problems (the strip) and info items (quiet rows, never counted; B4). Server order is kept. */
export function splitProblems(problems: readonly Problem[]): { alerts: Problem[]; info: Problem[] } {
  return {
    alerts: problems.filter((p) => p.severity !== "info"),
    info: problems.filter((p) => p.severity === "info"),
  };
}

/** Stable identity of the alert set; the live region only speaks when this changes. */
export const problemSetKey = (alerts: readonly Problem[]): string =>
  alerts
    .map((p) => p.id)
    .sort()
    .join("|");

/** Section whose failure leaves problems of `kind` frozen at their last known state (K4). */
const KIND_SECTION: Partial<Record<ProblemKind, OverviewSection>> = {
  service: "services",
  app: "apps",
  domain: "domains",
  network: "domains",
  backup: "backup",
  security: "security",
  disk: "device",
  battery: "device",
};

/** Whether a problem comes from a section that could not be read this time ("data terakhir X lalu"). */
export const isFrozen = (p: Pick<Problem, "kind">, unavailable: readonly OverviewSection[]): boolean => {
  const s = KIND_SECTION[p.kind];
  return s !== undefined && unavailable.includes(s);
};

const DOWN_CODES = new Set<Problem["code"]>(["service_down", "pm2_unavailable", "app_errored", "domain_unreachable"]);

/**
 * Badge of a count card: "Semua berjalan", "1 mati" or "1 perlu dicek", from the problems of that kind plus `held`
 * items that are down but whose own problem the server holds back behind a root cause (K3; QA N1).
 */
export function countBadge(
  kinds: readonly ProblemKind[],
  problems: readonly Problem[],
  held = 0,
): { tone: StatusTone; text: string } {
  const mine = problems.filter((p) => p.severity !== "info" && kinds.includes(p.kind));
  if (mine.length === 0 && held === 0) return { tone: "success", text: t.counts.allRunning };
  const down = mine.filter((p) => DOWN_CODES.has(p.code)).length + held;
  const tone: StatusTone = held > 0 || mine.some((p) => p.severity === "danger") ? "danger" : "warning";
  return { tone, text: down > 0 ? t.counts.down(down) : t.counts.attention(mine.length) };
}

/** Failed probes before the server opens a domain problem (DOMAIN_FAILS_TO_PROBLEM; not imported: keeps /panel lean). */
const DOMAIN_FAILS = 3;

/**
 * Domains down for good (≥ 3 failed probes, no answer or 5xx) without a problem of their own: the server holds it back
 * behind a root cause such as their errored app (K3). Wildcards are never probed; a stopped app's domain is intentional.
 */
export function heldDomains(domains: readonly Domain[], problems: readonly Problem[], apps: readonly App[]): number {
  return domains.filter((d) => {
    const { status, checkedAt, failures } = d.health;
    return (
      checkedAt !== null &&
      (failures ?? 0) >= DOMAIN_FAILS &&
      (status === null || status >= 500) &&
      !d.hostname.startsWith("*.") &&
      !apps.some((a) => a.name === d.app && a.status === "stopped") &&
      !problems.some((p) => p.kind === "domain" && p.target === d.hostname)
    );
  }).length;
}

/** Battery hint: charge state is always neutral (A9); the tone comes only from an open battery_low problem. */
export function batteryView(
  b: Battery | null,
  problems: readonly Problem[],
): { value: string; hint: string; tone: StatusTone | undefined } {
  if (b === null) return { value: t.device.batteryNone, hint: t.device.batteryNoneHint, tone: undefined };
  const status = b.status ?? (b.charging ? "charging" : "discharging");
  const low = problems.find((p) => p.code === "battery_low");
  const tone: StatusTone | undefined = low && low.severity !== "info" ? low.severity : undefined;
  return { value: `${formatNumber(b.percent)}%`, hint: t.device.charge[status], tone };
}

/** Temperature tone from the battery_hot problem (45/50 °C on the server); null reading = no tone. */
export function temperatureTone(problems: readonly Problem[]): StatusTone | undefined {
  const hot = problems.find((p) => p.code === "battery_hot");
  return hot && hot.severity !== "info" ? hot.severity : undefined;
}

/** "Beban sistem 20,9 · 20,7 · 20,0" + usual range and K6 tone, or the no-baseline note (neutral). */
export function loadView(
  load: readonly number[],
  baseline: LoadBaseline | null | undefined,
): { value: string; usual: string; tone: StatusTone | undefined } {
  // Always one decimal ("20,0", not "20"; QA #11). Load never reaches 1.000, so no thousands grouping is needed.
  const value = t.device.load(load.map((n) => n.toFixed(1).replace(".", ",")).join(" · "));
  if (!baseline) return { value, usual: t.device.loadNoBaseline, tone: undefined };
  const load5 = load[1] ?? 0;
  const ratio = baseline.p50 > 0 ? load5 / baseline.p50 : 0;
  const tone: StatusTone | undefined =
    ratio > LOAD_DANGER_RATIO ? "danger" : ratio > LOAD_WARN_RATIO ? "warning" : undefined;
  return {
    value,
    usual: t.device.loadUsual(formatNumber(baseline.p10, 0), formatNumber(baseline.p90, 0)),
    tone,
  };
}

/** "sejak 12 mnt" (whole minutes), "baru saja" under a minute; null before the problem was persisted. */
export function sinceText(since: string | null, now: Date): string | null {
  if (since === null) return null;
  const sec = Math.floor((now.getTime() - Date.parse(since)) / 1000);
  if (!Number.isFinite(sec)) return null;
  return sec < 60 ? t.sinceJustNow : t.sinceAgo(formatDuration(sec - (sec % 60)));
}

/** Second link of a problem row: the unit's log for service/app problems whose main link is not the log already. */
export function problemLogHref(p: Pick<Problem, "kind" | "target" | "href">): string | null {
  if (p.href.includes("/log")) return null;
  if (p.kind === "app") return `/panel/apps/${encodeURIComponent(p.target)}/log?stream=err`;
  if (p.kind === "service" && p.target) return `/panel/services/${encodeURIComponent(p.target)}/log`;
  return null;
}
