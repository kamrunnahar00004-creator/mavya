"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { Check, ChevronDown, Copy, Link2, PenLine, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

// Same flat, single-column language as the Analytics tab.
const card = "min-w-0 rounded-[var(--radius-2xl)] border border-[var(--color-border-soft)] bg-white";
const sectionTitle = "text-[15px] font-semibold text-[var(--color-ink)]";
const btnPrimary =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:cursor-default disabled:opacity-50";
const btnGhost =
  "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-ink)] disabled:cursor-default disabled:opacity-50";
const input =
  "min-h-[44px] w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-4 text-[15px] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)] focus:border-[var(--color-neutral-dark)] disabled:opacity-60";

type Facts = { size: string; materials: string; included: string; format: string };
type Result = {
  titles: string[];
  tags: { tag: string; isNew: boolean; reason: string }[];
  description: string;
  placeholders: string[];
  current: { title: string; tags: string[]; description: string };
};

const storageKey = (productId: string) => `mavya:write:${productId}`;
const EMPTY_FACTS: Facts = { size: "", materials: "", included: "", format: "" };

// Per-viewer convenience only: the last draft and facts survive a reload.
// Read via useSyncExternalStore (server snapshot = null) so there is no
// hydration mismatch and no setState-in-effect.
function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
const noSubscribe = () => () => {};

export function ListingWriteView({
  productId,
  linked,
  current,
  looksDigital,
  canWrite,
}: {
  productId: string;
  linked: boolean;
  current: { title: string; tagCount: number } | null;
  looksDigital: boolean;
  canWrite: boolean;
}) {
  const savedRaw = useSyncExternalStore(noSubscribe, () => readSaved(storageKey(productId)), () => null);
  const saved = useMemo(() => {
    try {
      return savedRaw ? (JSON.parse(savedRaw) as { result?: Result; facts?: Facts }) : null;
    } catch {
      return null;
    }
  }, [savedRaw]);
  const [editedFacts, setFacts] = useState<Facts | null>(null);
  const facts = editedFacts ?? saved?.facts ?? EMPTY_FACTS;
  const [showFacts, setShowFacts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setResult] = useState<Result | null>(null);
  const result = fresh ?? saved?.result ?? null;

  async function write(e?: FormEvent) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/listings/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, facts }),
      });
      const json = (await res.json().catch(() => ({}))) as Partial<Result> & { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false || !json.titles) {
        setError(json.error ?? "Could not write right now. Try again.");
        return;
      }
      const next = json as Result;
      setResult(next);
      try {
        localStorage.setItem(storageKey(productId), JSON.stringify({ result: next, facts }));
      } catch {
        /* ignore */
      }
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!linked || !current) {
    return (
      <main className="mx-auto w-full max-w-[760px] px-4 pb-20 pt-6 sm:px-6">
        <h1 className="sr-only">Write your listing</h1>
        <section className={cn(card, "p-6 sm:p-8")}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
            <Link2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-[22px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">Link your Etsy listing first</h2>
          <p className="mt-1.5 text-[15px] text-[var(--color-ink-muted)]">
            {linked ? "Mavya is reading your listing. Try again in a minute." : "Mavya writes from your current listing, so it needs the link."}
          </p>
          {!linked && (
            <Link href={`/dashboard/product/${productId}/analytics`} className={cn(btnPrimary, "mt-5")}>
              Link listing
            </Link>
          )}
        </section>
      </main>
    );
  }

  const field = (key: keyof Facts, label: string, placeholder: string) => (
    <div>
      <label htmlFor={`fact-${key}`} className="text-[13px] font-medium text-[var(--color-ink)]">
        {label}
      </label>
      <input
        id={`fact-${key}`}
        className={cn(input, "mt-1")}
        value={facts[key]}
        maxLength={300}
        placeholder={placeholder}
        disabled={busy}
        onChange={(e) => setFacts({ ...facts, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-[760px] flex-col gap-6 break-words px-4 pb-20 pt-6 sm:px-6">
      <h1 className="sr-only">Write your listing</h1>

      <form onSubmit={write} className={cn(card, "p-6 sm:p-7")}>
        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-primary)]">
          <PenLine className="h-4 w-4" aria-hidden="true" /> Write
        </p>
        <h2 className="mt-2 text-[22px] font-bold leading-tight tracking-[-0.01em] text-[var(--color-ink)]">
          {result ? "Your new listing is ready" : "Write a stronger title, tags, and description"}
        </h2>
        <p className="mt-1.5 text-[15px] text-[var(--color-ink-muted)]">
          Built from your listing and the tags top listings use. You now use {current.tagCount} of 13 tags.
        </p>

        <button
          type="button"
          onClick={() => setShowFacts((v) => !v)}
          aria-expanded={showFacts}
          className={cn(btnGhost, "-ml-3 mt-3")}
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", showFacts && "rotate-180")} aria-hidden="true" />
          Add details (optional)
        </button>
        {showFacts && (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {field("size", "Size", "e.g. 25 cm tall")}
            {field("materials", "Materials", "e.g. cotton yarn")}
            {field("included", "What is included", "e.g. 12-page PDF")}
            {looksDigital && field("format", "File format", "e.g. PDF, instant download")}
            <p className="text-[12.5px] text-[var(--color-ink-soft)] sm:col-span-2">Mavya never guesses these. Missing ones show as [blanks] to fill in.</p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button type="submit" className={btnPrimary} disabled={busy || !canWrite}>
            {busy ? "Writing… about 20 seconds" : result ? (
              <>
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Write again
              </>
            ) : (
              "Write my listing"
            )}
          </button>
          {!canWrite && <span className="text-[13px] text-[var(--color-weak)]">Update your billing to write listings.</span>}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-[14px] text-[var(--color-weak)]">
            {error}
          </p>
        )}
      </form>

      {busy && !result && (
        <div className={cn(card, "animate-pulse space-y-3 p-6 motion-reduce:animate-none")} aria-hidden="true">
          <div className="h-4 w-1/3 rounded bg-[var(--color-page-deep)]" />
          <div className="h-12 rounded bg-[var(--color-page-deep)]" />
          <div className="h-12 rounded bg-[var(--color-page-deep)]" />
        </div>
      )}

      {result && (
        <div className={cn("flex flex-col gap-6", busy && "opacity-60")}>
          <Titles result={result} />
          <Tags result={result} />
          <Description result={result} />
          <p className="px-1 text-[12.5px] leading-relaxed text-[var(--color-ink-soft)]">
            Review everything before pasting into Etsy. Mavya checks your listing daily and shows what happened after you change it.
          </p>
        </div>
      )}
    </main>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      /* clipboard blocked: the text is still selectable on screen */
    }
  }
  return (
    <button type="button" onClick={copy} className={cn(btnGhost, "flex-shrink-0 border border-[var(--color-border)]")} aria-live="polite">
      {done ? <Check className="h-3.5 w-3.5 text-[var(--color-strong)]" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {done ? "Copied" : label}
    </button>
  );
}

function Titles({ result }: { result: Result }) {
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="w-title">
      <h2 id="w-title" className={sectionTitle}>
        Title
      </h2>
      {result.current.title && <p className="mt-1 text-[13px] text-[var(--color-ink-soft)]">Now: {result.current.title}</p>}
      <ul className="mt-3 flex flex-col gap-2.5">
        {result.titles.map((t, i) => (
          <li key={t} className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] p-3.5">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-[var(--color-ink-soft)]">Option {i + 1}</p>
              <p className="mt-0.5 text-[15px] leading-snug text-[var(--color-ink)]">{t}</p>
              <p className="mt-1 text-[12px] tabular-nums text-[var(--color-ink-soft)]">{t.length}/140</p>
            </div>
            <CopyButton text={t} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tags({ result }: { result: Result }) {
  const newCount = result.tags.filter((t) => t.isNew).length;
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="w-tags">
      <div className="flex items-center justify-between gap-2">
        <h2 id="w-tags" className={sectionTitle}>
          Tags <span className="font-normal text-[var(--color-ink-soft)]">{result.tags.length}/13 · {newCount} new</span>
        </h2>
        <CopyButton text={result.tags.map((t) => t.tag).join(", ")} label="Copy all" />
      </div>
      <ul className="mt-2 divide-y divide-[var(--color-border-soft)]">
        {result.tags.map((t) => (
          <li key={t.tag} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] text-[var(--color-ink)]">{t.tag}</span>
              {t.isNew && (
                <span className="flex-shrink-0 rounded-full bg-[var(--color-strong-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-strong)]">New</span>
              )}
            </span>
            <span className="flex-shrink-0 text-right text-[12.5px] text-[var(--color-ink-muted)]">{t.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Description({ result }: { result: Result }) {
  // Highlight [placeholders] so the seller cannot miss them.
  const parts = result.description.split(/(\[[^\]\n]{2,80}\])/g);
  return (
    <section className={cn(card, "p-5 sm:p-6")} aria-labelledby="w-desc">
      <div className="flex items-center justify-between gap-2">
        <h2 id="w-desc" className={sectionTitle}>
          Description
        </h2>
        <CopyButton text={result.description} />
      </div>
      {result.placeholders.length > 0 && (
        <p className="mt-2 rounded-[var(--radius-lg)] bg-[var(--color-mid-soft)] px-3 py-2 text-[13px] text-[#7a4f0f]">
          Fill in {result.placeholders.length} blank{result.placeholders.length > 1 ? "s" : ""} before pasting: {result.placeholders.join(", ")}
        </p>
      )}
      <div className="mt-3 whitespace-pre-wrap text-[14.5px] leading-relaxed text-[var(--color-ink)]">
        {parts.map((p, i) =>
          /^\[[^\]\n]{2,80}\]$/.test(p) ? (
            <mark key={i} className="rounded bg-[var(--color-mid-soft)] px-1 text-[#7a4f0f]">
              {p}
            </mark>
          ) : (
            <span key={i}>{p}</span>
          )
        )}
      </div>
    </section>
  );
}
