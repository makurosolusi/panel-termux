import { useState } from "react";
import type { MetricPoint, MetricRange, MetricSeries } from "@/shared/monitor.types";
import { QueryView } from "@/web/components/query-view";
import { Section } from "@/web/components/section";
import { Button } from "@/web/components/ui/button";
import { tHistory } from "@/web/i18n/en.history";
import { formatMegabytes, formatPercent } from "@/web/shared/format";
import { useApiQuery } from "@/web/shared/use-api-query";
import { panelUrl } from "./panel.api";

const t = tHistory.trends;

/** One sample on the time axis; `v` null = no value (draws a gap). */
export type SparkPoint = { t: number; v: number | null };

/** Drawing box and value domain; points further apart than `maxGapMs` are not joined. */
export type SparkScale = { width: number; height: number; min: number; max: number; maxGapMs: number };

const VIEW_W = 120;
const VIEW_H = 32;
/** Keeps the stroke inside the box at the extremes. */
const INSET = 1.5;
/** Buckets come every `bucketSec`; one missing bucket (gap ≥ 1.5×) already breaks the line. */
const GAP_FACTOR = 1.5;
/** The sampler writes every minute and buckets are ≥ 15 min, so a 5 min poll is plenty. */
const TRENDS_REFRESH_MS = 300_000;
const RANGES: readonly MetricRange[] = ["24h", "7d"];

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * SVG path of a sparkline: x by time (first → last point), y by value in [min, max] (top = max). Every run of
 * joined points starts with `M` (+`h0`, so a lone point still shows as a round-capped dot); null values and time
 * gaps over `maxGapMs` start a new run. A flat domain draws in the middle. "" when nothing has a value.
 */
export function sparklinePath(points: readonly SparkPoint[], s: SparkScale): string {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return "";
  const span = last.t - first.t;
  const range = s.max - s.min;
  const x = (tm: number) => (span === 0 ? s.width / 2 : ((tm - first.t) / span) * s.width);
  const y = (v: number) => {
    if (range === 0) return s.height / 2;
    const ratio = (Math.min(s.max, Math.max(s.min, v)) - s.min) / range;
    return INSET + (1 - ratio) * (s.height - 2 * INSET);
  };
  let d = "";
  let prev: number | null = null;
  for (const p of points) {
    if (p.v === null) {
      prev = null;
      continue;
    }
    const joined = prev !== null && p.t - prev <= s.maxGapMs;
    d += joined ? `L${round1(x(p.t))} ${round1(y(p.v))}` : `M${round1(x(p.t))} ${round1(y(p.v))}h0`;
    prev = p.t;
  }
  return d;
}

/** Min/max/last of the values present; null when none. */
export function seriesStats(points: readonly SparkPoint[]): { min: number; max: number; last: number } | null {
  const values = points.flatMap((p) => (p.v === null ? [] : [p.v]));
  const last = values.at(-1);
  if (last === undefined) return null;
  return { min: Math.min(...values), max: Math.max(...values), last };
}

/** One metric of a series as spark points. */
export const toSparkPoints = (series: MetricSeries, field: keyof Omit<MetricPoint, "at">): SparkPoint[] =>
  series.points.map((p) => ({ t: Date.parse(p.at), v: p[field] }));

/** Accessible one-line summary of a sparkline (its `aria-label`). */
export function sparklineSummary(
  label: string,
  range: MetricRange,
  points: readonly SparkPoint[],
  fmt: (v: number) => string,
) {
  const st = seriesStats(points);
  return st
    ? t.summary(label, t.range[range], fmt(st.min), fmt(st.max), fmt(st.last))
    : t.summaryEmpty(label, t.range[range]);
}

/** Pure-SVG sparkline (`role="img"`, summary in `label`); `domain` fixes the scale (e.g. 0–100 %), else min–max. */
export function Sparkline({
  points,
  bucketSec,
  label,
  domain,
}: {
  points: readonly SparkPoint[];
  bucketSec: number;
  label: string;
  domain?: readonly [number, number];
}) {
  const st = seriesStats(points);
  const [min, max] = domain ?? [st?.min ?? 0, st?.max ?? 0];
  const d = sparklinePath(points, { width: VIEW_W, height: VIEW_H, min, max, maxGapMs: bucketSec * 1000 * GAP_FACTOR });
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="h-8 w-full overflow-visible text-brand"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function TrendCard(props: {
  label: string;
  range: MetricRange;
  points: SparkPoint[];
  bucketSec: number;
  fmt: (v: number) => string;
  domain?: readonly [number, number];
}) {
  const st = seriesStats(props.points);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-muted-foreground">{props.label}</span>
        <span className="text-muted-foreground tabular-nums">
          {st ? t.minMax(props.fmt(st.min), props.fmt(st.max)) : t.noData}
        </span>
      </div>
      <Sparkline
        points={props.points}
        bucketSec={props.bucketSec}
        domain={props.domain}
        label={sparklineSummary(props.label, props.range, props.points, props.fmt)}
      />
    </div>
  );
}

/** "Trends" block of the Overview: battery % and available memory over 24 h / 7 d (lazy chunk, own 5 min poll). */
export function MetricTrends() {
  const [range, setRange] = useState<MetricRange>("24h");
  const query = useApiQuery<MetricSeries>(panelUrl("/metrics", { range }), TRENDS_REFRESH_MS);
  const toggle = (
    // biome-ignore lint/a11y/useSemanticElements: a two-button segmented control, not a form fieldset
    <div role="group" aria-label={t.rangeLabel} className="flex gap-1">
      {RANGES.map((r) => (
        <Button
          key={r}
          size="sm"
          variant={r === range ? "secondary" : "ghost"}
          aria-pressed={r === range}
          onClick={() => setRange(r)}
          className="pointer-coarse:h-11"
        >
          {t.range[r]}
        </Button>
      ))}
    </div>
  );
  return (
    <Section title={t.title} description={t.description} action={toggle}>
      <QueryView
        query={query}
        isEmpty={(s) => s.points.length < 2}
        empty={<p className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">{t.empty}</p>}
      >
        {(s) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <TrendCard
              label={t.battery}
              range={s.range}
              points={toSparkPoints(s, "batteryPct")}
              bucketSec={s.bucketSec}
              fmt={(v) => formatPercent(v)}
              domain={[0, 100]}
            />
            <TrendCard
              label={t.memory}
              range={s.range}
              points={toSparkPoints(s, "memAvailableMb")}
              bucketSec={s.bucketSec}
              fmt={formatMegabytes}
            />
          </div>
        )}
      </QueryView>
    </Section>
  );
}
