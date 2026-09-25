"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Analytics chart in the YouTube Studio mold: the frame (axes, gridlines,
 * dates) is ALWAYS drawn for the chosen range, even on day 1, and fills in
 * one day at a time. Unknown days are left blank, never drawn as zero: a zero
 * bar would claim "nobody looked", which Mavya cannot know.
 */

export type MetricPoint = { date: string; views: number | null; favorites: number | null };
type Metric = "views" | "favorites" | "rate";

const METRICS: { key: Metric; label: string }[] = [
  { key: "views", label: "Views" },
  { key: "favorites", label: "Favorites" },
  { key: "rate", label: "Favorites per 100 views" },
];
const RANGES = [7, 28] as const;

const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const fmt = (n: number, metric: Metric) =>
  metric === "rate" ? n.toFixed(1) : n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1).replace(/\.0$/, "");

function valueOf(p: MetricPoint | undefined, metric: Metric): number | null {
  if (!p) return null;
  if (metric === "views") return p.views;
  if (metric === "favorites") return p.favorites;
  return p.views !== null && p.favorites !== null && p.views >= 1 ? (p.favorites / p.views) * 100 : null;
}

function niceCeil(max: number): number {
  if (max <= 0) return 10;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

export function MetricChart({
  title,
  points,
  endDate,
  markers,
  emptyNote = "First day of data arrives tomorrow.",
}: {
  title: string;
  points: MetricPoint[];
  /** Last day on the x axis (latest check, or today). */
  endDate: string;
  /** Days the seller changed something: label per date. */
  markers?: Map<string, string>;
  emptyNote?: string;
}) {
  const [metric, setMetric] = useState<Metric>("views");
  const [range, setRange] = useState<(typeof RANGES)[number]>(28);
  const [hover, setHover] = useState<number | null>(null);

  const byDate = new Map(points.map((p) => [p.date, p]));
  const days: string[] = [];
  for (let i = range - 1; i >= 0; i--) days.push(addDays(endDate, -i));
  const values = days.map((d) => valueOf(byDate.get(d), metric));
  const known = values.filter((v): v is number => v !== null);
  const total = metric === "rate" ? null : known.reduce((a, b) => a + b, 0);
  const top = niceCeil(Math.max(0, ...known));

  const W = 720;
  const H = 180;
  const padT = 8;
  const plotH = H - padT - 1;
  const slot = W / days.length;
  const barW = Math.max(3, Math.min(18, slot * 0.62));
  const hovered = hover !== null ? { date: days[hover], value: values[hover] } : null;

  return (
    <section className="min-w-0 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white" aria-label={title}>
      <div role="tablist" aria-label="Metric" className="flex overflow-x-auto border-b border-[var(--color-border-soft)]">
        {METRICS.map((m) => (
          <button
            key={m.key}
            role="tab"
            type="button"
            aria-selected={metric === m.key}
            onClick={() => setMetric(m.key)}
            className={cn(
              "min-h-[44px] flex-shrink-0 border-b-2 px-4 text-[13.5px] font-semibold transition-colors sm:px-5",
              metric === m.key
                ? "border-[var(--color-ink)] text-[var(--color-ink)]"
                : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-medium text-[var(--color-ink-muted)]">{title}</h3>
            <p className="mt-0.5 text-[26px] font-semibold leading-none tabular-nums text-[var(--color-ink)]">
              {known.length === 0 ? "–" : total !== null ? fmt(total, metric) : fmt(known.reduce((a, b) => a + b, 0) / known.length, metric)}
            </p>
            <p className="mt-1 text-[12.5px] text-[var(--color-ink-soft)]">
              {metric === "rate" ? "average per day" : `last ${range} days`}
              {known.length > 0 && known.length < range ? ` · ${known.length} day${known.length === 1 ? "" : "s"} of data so far` : ""}
            </p>
          </div>
          <div className="flex rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5" role="group" aria-label="Range">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={cn(
                  "min-h-[32px] rounded-[var(--radius-sm)] px-3 text-[12.5px] font-semibold tabular-nums transition-colors",
                  range === r ? "bg-[var(--color-page-deep)] text-[var(--color-ink)]" : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                )}
              >
                {r} days
              </button>
            ))}
          </div>
        </div>

        <div className="relative mt-4 flex gap-2">
          <div className="flex w-8 flex-shrink-0 flex-col justify-between pb-5 text-right text-[11px] tabular-nums text-[var(--color-ink-soft)]">
            <span>{fmt(top, metric)}</span>
            <span>{fmt(top / 2, metric)}</span>
            <span>0</span>
          </div>
          <div className="relative min-w-0 flex-1">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[180px] w-full" role="img" aria-label={`${title}, ${METRICS.find((m) => m.key === metric)!.label}, last ${range} days`}>
              {[0, 0.5, 1].map((f) => (
                <line
                  key={f}
                  x1={0}
                  x2={W}
                  y1={padT + plotH * (1 - f)}
                  y2={padT + plotH * (1 - f)}
                  stroke={f === 0 ? "var(--color-border-strong)" : "var(--color-border-soft)"}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {days.map((d, i) => {
                const v = values[i];
                const cx = slot * i + slot / 2;
                const h = v === null ? 0 : Math.max(v > 0 ? 2 : 0, (v / top) * plotH);
                return (
                  <g key={d}>
                    {v !== null && (
                      <rect
                        x={cx - barW / 2}
                        y={padT + plotH - h}
                        width={barW}
                        height={h}
                        rx={2}
                        fill={hover === i ? "var(--color-primary)" : "var(--color-neutral-dark)"}
                      />
                    )}
                    {markers?.has(d) && <circle cx={cx} cy={padT + 3} r={3.5} fill="var(--color-primary)" />}
                    <rect
                      x={slot * i}
                      y={0}
                      width={slot}
                      height={H}
                      fill="transparent"
                      tabIndex={0}
                      onMouseEnter={() => setHover(i)}
                      onMouseLeave={() => setHover(null)}
                      onFocus={() => setHover(i)}
                      onBlur={() => setHover(null)}
                      aria-label={`${shortDate(d)}: ${v === null ? "no data yet" : fmt(v, metric)}`}
                    />
                  </g>
                );
              })}
            </svg>
            {known.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-[70px] text-center text-[13.5px] text-[var(--color-ink-muted)]">{emptyNote}</p>
            )}
            <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-[var(--color-ink-soft)]">
              <span>{shortDate(days[0])}</span>
              <span>{shortDate(days[Math.floor(days.length / 2)])}</span>
              <span>{shortDate(days[days.length - 1])}</span>
            </div>
            {hovered && hover !== null && (
              <div
                className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--color-ink)] px-2.5 py-1.5 text-[12px] text-white"
                style={{ left: `${((slot * hover + slot / 2) / W) * 100}%` }}
              >
                <span className="font-semibold">{shortDate(hovered.date)}</span> · {hovered.value === null ? "no data yet" : fmt(hovered.value, metric)}
                {markers?.get(hovered.date) ? ` · ${markers.get(hovered.date)}` : ""}
              </div>
            )}
          </div>
        </div>
        {markers && markers.size > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden="true" /> you changed something
          </p>
        )}
      </div>
    </section>
  );
}

/** 14-day mini bar chart for a table row. Empty frame (baseline) until data. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const known = values.filter((v): v is number => v !== null);
  const max = Math.max(1, ...known);
  const W = 70;
  const H = 20;
  const slot = W / values.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-5 w-[70px]" aria-hidden="true">
      <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--color-border)" strokeWidth={1} />
      {values.map((v, i) =>
        v === null ? null : (
          <rect key={i} x={slot * i + 0.75} y={H - 1 - Math.max(1, (v / max) * (H - 2))} width={slot - 1.5} height={Math.max(1, (v / max) * (H - 2))} rx={0.75} fill="var(--color-neutral-dark)" />
        )
      )}
    </svg>
  );
}
