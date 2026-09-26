"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Check, Gauge, ImageIcon, Lock, PenLine, Search, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScoreChip } from "@/components/dashboard/shop-home";

export type StudioListing = { listingId: number; title: string; image: string | null; productId: string | null; score: number };
export type StudioPhoto = { id: string; main: boolean; src: string | null };

const MAX_REQUEST = 300;
const btn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-4 text-[14.5px] font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-page)] disabled:cursor-default disabled:opacity-45";
const btnPrimary =
  "inline-flex h-10 items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-[14.5px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)] disabled:cursor-default disabled:opacity-45";

/**
 * AI Studio screen: a request box like a chat composer, the three actions
 * under it, and the seller's listings below (then the chosen listing's
 * photos). Everything runs on the existing Photo and Write pipelines.
 */
export function StudioClient({
  listings,
  selected,
  opened,
  hasShop,
  paid,
}: {
  listings: StudioListing[];
  selected: { productId: string; title: string; photos: StudioPhoto[] } | null;
  opened: Record<number, string>;
  hasShop: boolean;
  paid: boolean;
}) {
  const router = useRouter();
  const [request, setRequest] = useState("");
  const [photoId, setPhotoId] = useState<string | null>(selected?.photos[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<number | "go" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (l: StudioListing) => {
    setError(null);
    const known = l.productId ?? opened[l.listingId];
    if (known) {
      router.push(`/dashboard/studio?listing=${known}`);
      return;
    }
    if (!paid) {
      router.push("/subscribe");
      return;
    }
    setBusy(l.listingId);
    try {
      const res = await fetch("/api/shop/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId: l.listingId }),
      });
      const json = (await res.json().catch(() => ({}))) as { productId?: string; error?: string };
      if (!res.ok || !json.productId) {
        setError(json.error ?? "Could not open that listing. Try again.");
        setBusy(null);
        return;
      }
      router.push(`/dashboard/studio?listing=${json.productId}`);
    } catch {
      setError("Network error. Try again.");
      setBusy(null);
    }
  };

  const note = request.trim();
  const go = (action: "score" | "polish" | "write") => {
    if (!selected) return;
    if (!paid) {
      router.push("/subscribe");
      return;
    }
    setBusy("go");
    const pid = selected.productId;
    if (action === "write") {
      router.push(`/dashboard/product/${pid}/write${note ? `?studioNote=${encodeURIComponent(note)}` : ""}`);
      return;
    }
    if (!photoId) return;
    const q = new URLSearchParams({ studioPhoto: photoId, studioAction: action });
    if (action === "polish" && note) q.set("studioNote", note);
    router.push(`/dashboard/product/${pid}?${q.toString()}`);
  };

  const shown = listings.filter((l) => !query.trim() || l.title.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <main className="mx-auto flex w-full max-w-[980px] flex-col items-center px-4 pb-24 pt-14 sm:pt-20">
      <h1 className="text-center text-[34px] font-semibold tracking-[-0.025em] text-[var(--color-ink)] sm:text-[42px]">AI Studio</h1>
      <p className="mt-2 max-w-[56ch] text-center text-[15px] text-[var(--color-ink-muted)]">
        Pick a listing and a photo, say what you want, then score it, polish it, or write new copy.
      </p>

      <div className="mt-8 w-full max-w-[760px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white shadow-[var(--shadow-soft)] transition-colors focus-within:border-[var(--color-ink)]">
        <label htmlFor="studio-request" className="sr-only">
          What should Mavya do?
        </label>
        <textarea
          id="studio-request"
          value={request}
          onChange={(e) => setRequest(e.target.value.slice(0, MAX_REQUEST))}
          rows={3}
          placeholder={
            selected
              ? `Tell Mavya what to change in "${selected.title}". For example: brighter light, plain white background, friendlier description.`
              : "Choose a listing below, then tell Mavya what to change."
          }
          className="block w-full resize-none rounded-t-[var(--radius-lg)] bg-transparent px-4 pt-4 text-[16px] leading-relaxed text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-soft)]"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-soft)] px-3 py-3">
          <span className="mr-auto px-1 text-[12.5px] tabular-nums text-[var(--color-ink-soft)]">
            {selected ? (photoId ? "Photo chosen" : "Choose a photo") : "No listing chosen"} · {request.length}/{MAX_REQUEST}
          </span>
          <button type="button" className={btn} disabled={!selected || !photoId || busy !== null} onClick={() => go("score")}>
            <Gauge className="h-4 w-4" aria-hidden="true" /> Score
          </button>
          <button type="button" className={btn} disabled={!selected || busy !== null} onClick={() => go("write")}>
            <PenLine className="h-4 w-4" aria-hidden="true" /> AI write
          </button>
          <button type="button" className={btnPrimary} disabled={!selected || !photoId || busy !== null} onClick={() => go("polish")}>
            {!paid ? <Lock className="h-4 w-4" aria-hidden="true" /> : <Wand2 className="h-4 w-4" aria-hidden="true" />}
            One-click polish
          </button>
        </div>
      </div>
      <p className="mt-3 max-w-[70ch] text-center text-[12.5px] text-[var(--color-ink-soft)]">
        Your request guides the polish and the writing. Mavya never adds facts or products that are not in your listing. Always check labels, text, colors, and included pieces on AI-improved photos before you use them.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-[14px] text-[var(--color-weak)]">
          {error}
        </p>
      )}

      {selected ? (
        <section className="mt-10 w-full" aria-labelledby="studio-photos-h">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="studio-photos-h" className="min-w-0 truncate text-[16px] font-semibold text-[var(--color-ink)]">
              {selected.title}
            </h2>
            <Link href="/dashboard/studio" className="inline-flex flex-shrink-0 items-center gap-1.5 text-[13.5px] font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Other listings
            </Link>
          </div>
          {selected.photos.length === 0 ? (
            <p className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white p-6 text-center text-[14px] text-[var(--color-ink-muted)]">
              Photos are still being imported from Etsy. Refresh in a minute, or use AI write now.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              {selected.photos.map((p, i) => {
                const on = p.id === photoId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPhotoId(p.id)}
                      aria-pressed={on}
                      className={cn(
                        "relative block aspect-square w-full overflow-hidden rounded-[var(--radius-lg)] border-2 bg-[var(--color-page-deep)] transition-colors",
                        on ? "border-[var(--color-primary)]" : "border-transparent hover:border-[var(--color-border-strong)]"
                      )}
                    >
                      {p.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.src} alt={p.main ? "Main photo" : `Photo ${i + 1}`} className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="m-auto h-6 w-6 text-[var(--color-ink-soft)]" aria-hidden="true" />
                      )}
                      {p.main && <span className="absolute left-2 top-2 rounded-[var(--radius-sm)] bg-white/95 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-ink)]">Main</span>}
                      {on && (
                        <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary)] text-white">
                          <Check className="h-4 w-4" aria-hidden="true" />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <section className="mt-10 w-full" aria-labelledby="studio-listings-h">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="studio-listings-h" className="text-[16px] font-semibold text-[var(--color-ink)]">
              Choose a listing
            </h2>
            {listings.length > 0 && (
              <label className="flex h-10 w-full max-w-[280px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white px-3">
                <Search className="h-4 w-4 text-[var(--color-ink-soft)]" aria-hidden="true" />
                <span className="sr-only">Search listings</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search listings" className="w-full bg-transparent text-[14.5px] outline-none placeholder:text-[var(--color-ink-soft)]" />
              </label>
            )}
          </div>
          {listings.length === 0 ? (
            <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white p-8 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-[var(--color-primary)]" aria-hidden="true" />
              <p className="mt-3 text-[15px] font-semibold text-[var(--color-ink)]">{hasShop ? "Your listings are loading" : "Connect your shop first"}</p>
              <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">Studio works on your own Etsy listings.</p>
              <Link href="/dashboard" className={cn(btnPrimary, "mt-5")}>
                {hasShop ? "Go to Overview" : "Connect your shop"}
              </Link>
            </div>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((l) => (
                <li key={l.listingId}>
                  <button
                    type="button"
                    onClick={() => void pick(l)}
                    disabled={busy !== null}
                    className="group flex w-full flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white text-left transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-60"
                  >
                    <span className="aspect-[4/3] w-full overflow-hidden bg-[var(--color-page-deep)]">
                      {l.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.image} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                      )}
                    </span>
                    <span className="flex items-start gap-2 p-3">
                      <span className="line-clamp-2 min-w-0 flex-1 text-[13.5px] leading-snug text-[var(--color-ink)]">{busy === l.listingId ? "Opening..." : l.title}</span>
                      <ScoreChip score={l.score} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
