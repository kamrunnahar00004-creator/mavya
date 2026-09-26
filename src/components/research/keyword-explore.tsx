"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronsUpDown, Heart, Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeywordRow } from "@/lib/research-store";

/**
 * Keyword Explore table, laid out like Alura's: checkbox, Keyword, volume,
 * change, Competition, KD bar, Score box, Trend line. Mavya colors, Mavya's
 * square corners. "Views/day" stands where Alura shows search volume: Etsy
 * does not publish search volume, so Mavya shows the views the top 25
 * listings get a day (real). KD and Score are Mavya formulas over real
 * numbers (tooltips say so).
 */

type Col = "views" | "change" | "competition" | "kd" | "score" | "trend";
const COLS: { key: Col; label: string; title: string }[] = [
  { key: "views", label: "Views/day", title: "Views the top 25 Etsy listings for this keyword get a day. Etsy does not publish search volume." },
  { key: "change", label: "Change", title: "Change in views a day over the days Mavya has checked (up to 3 months)." },
  { key: "competition", label: "Competition", title: "Active Etsy listings matching this keyword." },
  { key: "kd", label: "KD", title: "Keyword difficulty 0-100, from the number of competing listings. A Mavya estimate." },
  { key: "score", label: "Score", title: "Opportunity 0-100: busy top listings and few competitors. A Mavya estimate." },
  { key: "trend", label: "Trend", title: "Views a day over the days Mavya has checked." },
];
const SORTABLE_ICON = new Set(["keyword", "competition", "kd", "score"]);
const STORE_KEY = "mavya.kw.cols";

const toneOf = (v: number, good: number, mid: number, higherIsBetter: boolean) => {
  const g = higherIsBetter ? v >= good : v <= good;
  const m = higherIsBetter ? v >= mid : v <= mid;
  return g ? "var(--color-strong)" : m ? "var(--color-mid)" : "var(--color-weak)";
};

export function Sparkline({ points, width = 84, height = 28 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <span className="text-[14px] text-[var(--color-ink-soft)]">–</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points.map((p, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)},${(height - 2 - ((p - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const color = last > first * 1.05 ? "var(--color-strong)" : last < first * 0.95 ? "var(--color-weak)" : "var(--color-ink-soft)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Check({ checked, onChange, label, mixed }: { checked: boolean; onChange: () => void; label: string; mixed?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={mixed ? "mixed" : checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border transition-colors",
        checked || mixed ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white" : "border-[var(--color-border-strong)] bg-white hover:border-[var(--color-ink-muted)]"
      )}
    >
      {checked && (
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
          <path d="M2.5 6.2l2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {mixed && !checked && <span className="h-[2px] w-2 rounded bg-white" aria-hidden="true" />}
    </button>
  );
}

const fmt = (v: number | null) => (v === null ? "–" : Math.round(v).toLocaleString("en-US"));

export function KeywordExplore({
  rows,
  savedRefs,
  sortKey,
  sortHrefs,
  keywordHref,
  filterSlot,
  findAction,
  findHidden,
  find,
  footer,
  mode = "explore",
}: {
  rows: KeywordRow[];
  savedRefs: string[];
  sortKey?: string;
  sortHrefs?: Record<string, string>;
  keywordHref: Record<string, string>;
  filterSlot?: ReactNode;
  findAction?: string;
  findHidden?: Record<string, string>;
  find?: string | null;
  footer?: ReactNode;
  mode?: "explore" | "saved";
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Set<string>>(new Set(savedRefs));
  const [hidden, setHidden] = useState<Set<Col>>(new Set());
  const [displayOpen, setDisplayOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(Boolean(find));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const displayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        const cols = (JSON.parse(raw) as string[]).filter((c): c is Col => COLS.some((x) => x.key === c));
        // Restoring a per-viewer preference after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setHidden(new Set(cols));
      }
    } catch {
      // Preference only.
    }
  }, []);

  useEffect(() => {
    if (!displayOpen) return;
    const close = (e: MouseEvent) => {
      if (displayRef.current && !displayRef.current.contains(e.target as Node)) setDisplayOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [displayOpen]);

  const toggleCol = (c: Col) => {
    const next = new Set(hidden);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setHidden(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify([...next]));
    } catch {
      // Preference only.
    }
  };

  const all = rows.length > 0 && rows.every((r) => selected.has(r.keyword));
  const some = rows.some((r) => selected.has(r.keyword));
  const toggleAll = () => setSelected(all ? new Set() : new Set(rows.map((r) => r.keyword)));
  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  };

  const bulk = async (save: boolean) => {
    setBusy(true);
    setMessage(null);
    const keys = [...selected];
    const done = new Set(saved);
    let failed: string | null = null;
    for (const k of keys) {
      try {
        const res = await fetch("/api/research/save", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: "keyword", ref: k, label: k, saved: save }),
        });
        if (res.ok) {
          if (save) done.add(k);
          else done.delete(k);
        } else {
          failed = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save some keywords.";
        }
      } catch {
        failed = "Could not save some keywords.";
      }
    }
    setSaved(done);
    setBusy(false);
    setMessage(failed ?? (save ? `Saved ${keys.length} ${keys.length === 1 ? "keyword" : "keywords"}.` : `Removed ${keys.length}.`));
    if (!failed) setSelected(new Set());
  };

  const show = (c: Col) => !hidden.has(c);
  const head = (key: string, label: string, title?: string, align: "left" | "right" = "right") => {
    const href = sortHrefs?.[key];
    const inner = (
      <>
        {label}
        {SORTABLE_ICON.has(key) && <ChevronsUpDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </>
    );
    return (
      <th key={key} scope="col" title={title} className={cn("whitespace-nowrap px-4 py-4 font-medium", align === "left" ? "text-left" : "text-right")}>
        {href ? (
          <Link href={href} className={cn("inline-flex items-center gap-1 hover:text-[var(--color-ink)]", sortKey === key && "text-[var(--color-ink)]")}>
            {inner}
          </Link>
        ) : (
          <span className="inline-flex items-center gap-1">{inner}</span>
        )}
      </th>
    );
  };

  return (
    <div className="bg-white">
      {mode === "explore" && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3 sm:px-7">
          <div className="flex min-w-0 flex-wrap items-center gap-2">{filterSlot}</div>
          <div className="ml-auto flex items-center gap-2">
            {searchOpen && findAction && (
              <form action={findAction} method="get" className="flex items-center" role="search">
                {Object.entries(findHidden ?? {}).map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <input
                  name="find"
                  defaultValue={find ?? ""}
                  autoFocus
                  maxLength={80}
                  placeholder="Find a keyword"
                  aria-label="Find a keyword"
                  className="h-10 w-[200px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3 text-[14.5px] outline-none focus:border-[var(--color-ink)] sm:w-[260px]"
                />
              </form>
            )}
            <button
              type="button"
              onClick={() => setSearchOpen((v) => !v)}
              aria-label={searchOpen ? "Close find" : "Find a keyword"}
              className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-page)]"
            >
              {searchOpen ? <X className="h-4.5 w-4.5" aria-hidden="true" /> : <Search className="h-4.5 w-4.5" aria-hidden="true" />}
            </button>
            <div className="relative" ref={displayRef}>
              <button
                type="button"
                onClick={() => setDisplayOpen((v) => !v)}
                aria-expanded={displayOpen}
                className="inline-flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-4 text-[15px] font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-page)]"
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                Display
              </button>
              {displayOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-[220px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-1.5 shadow-[var(--shadow-soft-strong)]">
                  <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-[var(--color-ink-soft)]">Columns</p>
                  {COLS.map((c) => (
                    <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[14px] text-[var(--color-ink)] hover:bg-[var(--color-page)]">
                      <Check checked={show(c.key)} onChange={() => toggleCol(c.key)} label={`Show ${c.label}`} />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[16px]">
          <thead className="border-b border-[var(--color-border)] text-[14px] text-[var(--color-ink-muted)]">
            <tr>
              <th scope="col" className="w-12 py-4 pl-4 sm:pl-7">
                <Check checked={all} mixed={some && !all} onChange={toggleAll} label="Select all keywords" />
              </th>
              {head("keyword", "Keyword", undefined, "left")}
              {COLS.filter((c) => show(c.key)).map((c) =>
                c.key === "trend" ? (
                  <th key="trend" scope="col" title={c.title} className="w-[120px] py-4 pl-6 pr-4 text-left font-medium sm:pr-7">
                    Trend
                  </th>
                ) : (
                  head(c.key, c.label, c.title)
                )
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border-soft)]">
            {rows.map((r) => {
              const isSel = selected.has(r.keyword);
              return (
                <tr key={r.keyword} className={cn("transition-colors hover:bg-[var(--color-page)]", isSel && "bg-[var(--color-tint)] hover:bg-[var(--color-tint)]")}>
                  <td className="py-5 pl-4 sm:pl-7">
                    <Check checked={isSel} onChange={() => toggle(r.keyword)} label={`Select ${r.keyword}`} />
                  </td>
                  <td className="px-4 py-5">
                    <span className="inline-flex items-center gap-2">
                      <Link href={keywordHref[r.keyword] ?? "#"} className="font-semibold text-[var(--color-ink)] hover:underline">
                        {r.keyword}
                      </Link>
                      {saved.has(r.keyword) && <Heart className="h-3.5 w-3.5 fill-[var(--color-primary)] text-[var(--color-primary)]" aria-label="Saved" />}
                    </span>
                  </td>
                  {show("views") && <td className="px-4 py-5 text-right tabular-nums text-[var(--color-ink)]">{fmt(r.viewsPerDay)}</td>}
                  {show("change") && (
                    <td
                      className="px-4 py-5 text-right tabular-nums"
                      style={{ color: r.changePct === null ? "var(--color-ink-soft)" : r.changePct >= 0 ? "var(--color-strong)" : "var(--color-weak)" }}
                    >
                      {r.changePct === null ? "–" : `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(1)}%`}
                    </td>
                  )}
                  {show("competition") && <td className="px-4 py-5 text-right tabular-nums text-[var(--color-ink)]">{r.competition.toLocaleString("en-US")}</td>}
                  {show("kd") && (
                    <td className="px-4 py-5">
                      {r.difficulty === null ? (
                        <span className="block text-right text-[var(--color-ink-soft)]">–</span>
                      ) : (
                        <span className="flex items-center justify-end gap-3">
                          <span className="h-[5px] w-14 overflow-hidden rounded-full bg-[var(--color-page-deep)]" aria-hidden="true">
                            <span className="block h-full rounded-full" style={{ width: `${Math.max(3, r.difficulty)}%`, background: toneOf(r.difficulty, 30, 60, false) }} />
                          </span>
                          <span className="w-7 text-right text-[14px] font-semibold tabular-nums" style={{ color: toneOf(r.difficulty, 30, 60, false) }}>
                            {r.difficulty}
                          </span>
                        </span>
                      )}
                    </td>
                  )}
                  {show("score") && (
                    <td className="px-4 py-5 text-right">
                      {r.score === null ? (
                        <span className="text-[var(--color-ink-soft)]">–</span>
                      ) : (
                        <span
                          className="inline-flex h-[30px] min-w-[34px] items-center justify-center rounded-[var(--radius-md)] px-1.5 text-[14px] font-bold tabular-nums text-white"
                          style={{ background: toneOf(r.score, 45, 30, true) }}
                        >
                          {r.score}
                        </span>
                      )}
                    </td>
                  )}
                  {show("trend") && (
                    <td className="py-5 pl-6 pr-4 sm:pr-7">
                      <Sparkline points={r.trend} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer}

      {(selected.size > 0 || message) && (
        <div className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-2 pl-4 shadow-[var(--shadow-soft-strong)] lg:ml-[116px]" role="status">
          <span className="text-[14px] font-semibold text-[var(--color-ink)]">{selected.size > 0 ? `${selected.size} selected` : message}</span>
          {selected.size > 0 && (
            <>
              {mode === "explore" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void bulk(true)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3.5 text-[14px] font-semibold text-white hover:bg-[var(--color-primary-hover)] disabled:opacity-60"
                >
                  <Heart className="h-4 w-4" aria-hidden="true" /> Save
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void bulk(false)}
                className="inline-flex h-9 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3.5 text-[14px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-page)] disabled:opacity-60"
              >
                Remove from saved
              </button>
            </>
          )}
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => {
              setSelected(new Set());
              setMessage(null);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-ink-muted)] hover:bg-[var(--color-page)] hover:text-[var(--color-ink)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
