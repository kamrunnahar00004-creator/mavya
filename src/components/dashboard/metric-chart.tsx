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

/** Smooth line through points (Catmull-Rom as Bezier), control points clamped to the plot. */
function smoothPath(pts: { x: number; y: number }[], yMin: number, yMax: number): string {
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
  const clamp = (y: number) => Math.min(yMax, Math.max(yMin, y));
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: clamp(p1.y + (p2.y - p0.y) / 6) };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: clamp(p2.y - (p3.y - p1.y) / 6) };
    d += ` C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`;
  }
  return d;
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
  const H = 240;
  const padT = 10;
  const plotH = H - padT - 1;
  const slot = W / days.length;
  const xAt = (i: number) => slot * i + slot / 2;
  const yAt = (v: number) => padT + plotH - (v / top) * plotH;
  const hovered = hover !== null ? { date: days[hover], value: values[hover] } : null;
  // Runs of consecutive known days: each is drawn as its own smooth line with
  // a soft area under it. A gap stays a gap; it is never drawn as zero.
  const runs: { i: number; v: number }[][] = [];
  values.forEach((v, i) => {
    if (v === null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ i, v });
    else runs.push([{ i, v }]);
  });

  return (
    <section className="min-w-0 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white" aria-label={title}>
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

        <div className="relative mt-5 flex gap-3">
          <div className="flex w-9 flex-shrink-0 flex-col justify-between pb-6 text-right text-[11.5px] tabular-nums text-[var(--color-ink-soft)]">
            {[1, 0.75, 0.5, 0.25, 0].map((f) => (
              <span key={f}>{fmt(top * f, metric)}</span>
            ))}
          </div>
          <div className="relative min-w-0 flex-1" onMouseLeave={() => setHover(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[240px] w-full" role="img" aria-label={`${title}, ${METRICS.find((m) => m.key === metric)!.label}, last ${range} days`}>
              <defs>
                <linearGradient id="metric-area" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((f) => (
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
              {hover !== null && (
                <line x1={xAt(hover)} x2={xAt(hover)} y1={padT} y2={padT + plotH} stroke="var(--color-ink-soft)" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              )}
              {runs.map((run) => {
                const pts = run.map(({ i, v }) => ({ x: xAt(i), y: yAt(v) }));
                const line = smoothPath(pts, padT, padT + plotH);
                const area = `${line} L${pts[pts.length - 1].x},${padT + plotH} L${pts[0].x},${padT + plotH} Z`;
                return (
                  <g key={run[0].i}>
                    {pts.length > 1 && <path d={area} fill="url(#metric-area)" />}
                    {pts.length > 1 && <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
                  </g>
                );
              })}
              {days.map((d, i) => (
                <rect
                  key={d}
                  x={slot * i}
                  y={0}
                  width={slot}
                  height={H}
                  fill="transparent"
                  tabIndex={0}
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  aria-label={`${shortDate(d)}: ${values[i] === null ? "no data yet" : fmt(values[i] as number, metric)}`}
                />
              ))}
            </svg>
            {/* Dots are HTML so they stay round when the chart stretches. */}
            {runs.flat().filter(({ i }) => runs.some((r) => r.length === 1 && r[0].i === i) || i === hover).map(({ i, v }) => (
              <span
                key={`dot-${i}`}
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--color-primary)] shadow-[0_0_0_1px_var(--color-primary)]"
                style={{ left: `${(xAt(i) / W) * 100}%`, top: `${(yAt(v) / H) * 240}px` }}
              />
            ))}
            {days.map((d, i) =>
              markers?.has(d) ? (
                <span
                  key={`mark-${d}`}
                  className="pointer-events-none absolute top-0 h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--color-ink)]"
                  style={{ left: `${(xAt(i) / W) * 100}%` }}
                />
              ) : null
            )}
            {known.length === 0 && (
              <p className="pointer-events-none absolute inset-x-0 top-[100px] text-center text-[13.5px] text-[var(--color-ink-muted)]">{emptyNote}</p>
            )}
            <div className="mt-2 flex justify-between text-[11.5px] tabular-nums text-[var(--color-ink-soft)]">
              <span>{shortDate(days[0])}</span>
              <span>{shortDate(days[Math.floor(days.length / 2)])}</span>
              <span>{shortDate(days[days.length - 1])}</span>
            </div>
            {hovered && hover !== null && (
              <div
                className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3 py-2 text-[12.5px] shadow-[var(--shadow-soft-strong)]"
                style={{ left: `${(xAt(hover) / W) * 100}%`, transform: hover > days.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)" }}
              >
                <p className="font-semibold text-[var(--color-ink)]">{shortDate(hovered.date)}</p>
                <p className="mt-1 flex items-center justify-between gap-4 text-[var(--color-ink-muted)]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />
                    {METRICS.find((m) => m.key === metric)!.label}
                  </span>
                  <span className="font-semibold tabular-nums text-[var(--color-ink)]">{hovered.value === null ? "no data" : fmt(hovered.value, metric)}</span>
                </p>
                {markers?.get(hovered.date) && <p className="mt-1 text-[var(--color-ink-muted)]">{markers.get(hovered.date)}</p>}
              </div>
            )}
          </div>
        </div>
        {markers && markers.size > 0 && (
          <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--color-ink-muted)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--color-ink)]" aria-hidden="true" /> you changed something
          </p>
        )}
      </div>
    </section>
  );
}

/** 14-day mini trend line for a table row: green rising, red falling, gray flat. */
export function Sparkline({ values }: { values: (number | null)[] }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  const W = 72;
  const H = 20;
  if (pts.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} className="h-5 w-[72px]" aria-hidden="true" />;
  const max = Math.max(1, ...pts.map((p) => p.v));
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (W - 2) + 1;
  const y = (v: number) => H - 2 - (v / max) * (H - 4);
  const half = Math.floor(pts.length / 2);
  const avg = (a: { v: number }[]) => a.reduce((s, p) => s + p.v, 0) / Math.max(1, a.length);
  const change = avg(pts.slice(half)) / Math.max(0.01, avg(pts.slice(0, half)));
  const color = change >= 1.15 ? "var(--color-strong)" : change <= 0.87 ? "var(--color-weak)" : "var(--color-ink-soft)";
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-5 w-[72px]" aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
