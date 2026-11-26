import { describe, expect, test } from "bun:test";
import type { DomainCheck, MetricSeries, ProblemEvent } from "@/shared/monitor.types";
import { heartbeatBars, heartbeatSummary } from "@/web/panel/heartbeat.strip";
import { navBadgeView } from "@/web/panel/nav.badge.provider";
import { closedText, eventDurationSec, groupByDay } from "@/web/panel/problems.page";
import { seriesStats, sparklinePath, sparklineSummary, toSparkPoints } from "@/web/panel/sparkline";

const MIN = 60_000;
const scale = { width: 100, height: 10, min: 0, max: 100, maxGapMs: 15 * MIN };

describe("sparklinePath", () => {
  test("maps time to x and value to y (top = max, 1.5 inset)", () => {
    const d = sparklinePath(
      [
        { t: 0, v: 0 },
        { t: 10 * MIN, v: 50 },
        { t: 20 * MIN, v: 100 },
      ],
      scale,
    );
    expect(d).toBe("M0 8.5h0L50 5L100 1.5");
  });

  test("null values and long time gaps start a new run", () => {
    const d = sparklinePath(
      [
        { t: 0, v: 100 },
        { t: 10 * MIN, v: null },
        { t: 20 * MIN, v: 100 },
        { t: 30 * MIN, v: 100 },
        { t: 100 * MIN, v: 0 }, // 70 min after the previous point > 15 min gap
      ],
      scale,
    );
    expect(d).toBe("M0 1.5h0M20 1.5h0L30 1.5M100 8.5h0");
  });

  test("clamps outside the domain, centres a flat domain, empty input → ''", () => {
    expect(
      sparklinePath(
        [
          { t: 0, v: 150 },
          { t: MIN, v: -5 },
        ],
        scale,
      ),
    ).toBe("M0 1.5h0L100 8.5");
    expect(
      sparklinePath(
        [
          { t: 0, v: 7 },
          { t: MIN, v: 7 },
        ],
        { ...scale, min: 7, max: 7 },
      ),
    ).toBe("M0 5h0L100 5");
    expect(sparklinePath([], scale)).toBe("");
    expect(sparklinePath([{ t: 0, v: null }], scale)).toBe("");
  });

  test("series → points, stats and accessible summary", () => {
    const series: MetricSeries = {
      range: "24h",
      bucketSec: 900,
      points: [
        { at: "2026-11-26T00:00:00.000Z", batteryPct: 80, memAvailableMb: 4000, diskFreeMb: null, load5: null },
        { at: "2026-11-26T00:15:00.000Z", batteryPct: null, memAvailableMb: 3500, diskFreeMb: null, load5: null },
        { at: "2026-11-26T00:30:00.000Z", batteryPct: 62, memAvailableMb: 3900, diskFreeMb: null, load5: null },
      ],
    };
    const battery = toSparkPoints(series, "batteryPct");
    expect(battery.map((p) => p.v)).toEqual([80, null, 62]);
    expect(battery[1]?.t).toBe(Date.parse("2026-11-26T00:15:00.000Z"));
    expect(seriesStats(battery)).toEqual({ min: 62, max: 80, last: 62 });
    expect(sparklineSummary("Baterai", "24h", battery, (v) => `${v}%`)).toBe(
      "Baterai 24 jam terakhir: terendah 62%, tertinggi 80%, terakhir 62%.",
    );
    expect(sparklineSummary("Baterai", "7d", [], String)).toBe("Baterai 7 hari terakhir: belum ada data.");
  });
});

const event = (id: number, opened: Date, closed: Date | null): ProblemEvent => ({
  id,
  code: "service_down",
  kind: "service",
  target: "postgres",
  severity: "danger",
  params: {},
  openedAt: opened.toISOString(),
  closedAt: closed?.toISOString() ?? null,
  notified: false,
});

describe("problem history", () => {
  test("groups by local day, keeping newest-first order", () => {
    const groups = groupByDay([
      event(3, new Date(2026, 10, 27, 9, 0), null),
      event(2, new Date(2026, 10, 26, 23, 59), new Date(2026, 10, 27, 0, 10)),
      event(1, new Date(2026, 10, 26, 0, 1), new Date(2026, 10, 26, 0, 5)),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-11-27", "2026-11-26"]);
    expect(groups.map((g) => g.items.map((e) => e.id))).toEqual([[3], [2, 1]]);
    expect(groups[0]?.label).toContain("2026");
    expect(groupByDay([])).toEqual([]);
  });

  test("duration: closed span, open until now, never negative", () => {
    const opened = new Date(2026, 10, 26, 10, 0);
    expect(eventDurationSec(event(1, opened, new Date(2026, 10, 26, 10, 12)))).toBe(720);
    expect(eventDurationSec(event(2, opened, null), opened.getTime() + 90_000)).toBe(90);
    expect(eventDurationSec(event(3, opened, null), opened.getTime() - 1000)).toBe(0);
  });
});

describe("heartbeat strip", () => {
  const check = (status: number | null): DomainCheck => ({ at: "2026-11-26T00:00:00.000Z", status });

  test("counts < 500 as healthy and pads to 30 slots with the newest at the right", () => {
    const checks = [check(200), check(502), check(null), check(403)];
    expect(heartbeatSummary(checks)).toEqual({ ok: 2, total: 4 });
    const bars = heartbeatBars(checks);
    expect(bars).toHaveLength(30);
    expect(bars.slice(0, 26).every((b) => b === "none")).toBe(true);
    expect(bars.slice(26)).toEqual(["ok", "fail", "fail", "ok"]);
  });

  test("keeps only the newest 30", () => {
    const checks = [...Array.from({ length: 5 }, () => check(530)), ...Array.from({ length: 30 }, () => check(200))];
    expect(heartbeatSummary(checks)).toEqual({ ok: 30, total: 30 });
  });
});

describe("nav badge", () => {
  test("counts danger + warning, danger tone wins, none when zero or unknown", () => {
    expect(navBadgeView({ danger: 1, warning: 2, sampledAt: null })).toEqual({ count: 3, tone: "danger" });
    expect(navBadgeView({ danger: 0, warning: 2, sampledAt: null })).toEqual({ count: 2, tone: "warning" });
    expect(navBadgeView({ danger: 0, warning: 0, sampledAt: null })).toBeNull();
    expect(navBadgeView(undefined)).toBeNull();
  });
});

describe("closedText (QA #13)", () => {
  test("by local calendar day, not 24 h spans", () => {
    const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
    const now = new Date(2026, 10, 27, 2, 30);
    expect(closedText(at(27, 1, 5), now)).toBe("hari ini 01.05");
    expect(closedText(at(26, 21, 40), now)).toBe("kemarin 21.40");
    // 26.5 h ago but two midnights back: not "kemarin"
    expect(closedText(at(25, 23, 52), now)).not.toContain("kemarin");
  });
});
