"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ImageOff,
  Loader2,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  /** Canonical storage path; used to re-sign the thumbnail if the URL expired. */
  storagePath?: string | null;
  score: number | null;
  /** Highest-priority recommended fix (only for sub-8 photos). */
  topFix?: string | null;
  ratingJobId?: string | null;
  ratingStatus?: "queued" | "scoring" | "completed" | "failed" | "cancelled" | null;
  ratingError?: string | null;
};

function scoreColors(score: number): { bg: string; fg: string } {
  if (score >= 8) return { bg: "var(--color-strong-soft)", fg: "var(--color-strong)" };
  if (score >= 6) return { bg: "var(--color-mid-soft)", fg: "var(--color-mid)" };
  return { bg: "var(--color-weak-soft)", fg: "var(--color-weak)" };
}

function scoreBand(score: number): string {
  if (score >= 8) return "Strong";
  if (score >= 6) return "Almost there";
  return "Needs work";
}

/**
 * One product tile in the dashboard grid. Thumbnail + name link to the product's
 * rating; a hover kebab menu offers Rename (inline) and Delete (confirmed,
 * danger-styled). All writes run under the user's RLS.
 */
export function ProductCard({
  id,
  name,
  thumbnailUrl,
  storagePath,
  score,
  topFix,
  ratingJobId,
  ratingStatus,
  ratingError,
}: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(thumbnailUrl);
  const refreshedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!ratingJobId || (ratingStatus !== "queued" && ratingStatus !== "scoring")) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/score/jobs?id=${encodeURIComponent(ratingJobId)}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { status?: string };
        if (body.status && body.status !== "queued" && body.status !== "scoring") {
          router.refresh();
        }
      } catch {
        // The durable worker continues; the next poll can recover the UI.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [ratingJobId, ratingStatus, router]);

  // Expired signed URL: re-sign once through the authenticated endpoint.
  async function refreshThumb() {
    if (refreshedRef.current || !storagePath) return;
    refreshedRef.current = true;
    try {
      const res = await fetch("/api/storage/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: storagePath }),
      });
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (data?.url) setImgSrc(data.url);
    } catch {
      // leave the placeholder
    }
  }

  const href = `/dashboard/product/${id}`;

  async function saveRename() {
    const next = value.trim();
    setRenaming(false);
    if (next === name.trim()) return;
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase
        .from("products")
        .update({ name: next || null })
        .eq("id", id);
      if (error) throw error;
      router.refresh();
    } catch {
      setValue(name);
    } finally {
      setBusy(false);
    }
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setValue(name);
      setRenaming(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      // Best-effort storage cleanup (DB cascade handles photos/audits rows).
      if (user) {
        const prefix = `${user.id}/${id}`;
        const { data: files } = await supabase.storage
          .from("product-photos")
          .list(prefix);
        if (files?.length) {
          await supabase.storage
            .from("product-photos")
            .remove(files.map((f) => `${prefix}/${f.name}`));
        }
      }
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="group relative flex flex-col rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(25,23,20,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-soft-strong)]">
      <Link
        href={href}
        prefetch
        aria-label={`Open ${name}`}
        className="relative block aspect-square w-full overflow-hidden rounded-t-[var(--radius-xl)] bg-[var(--color-page-deep)]"
      >
        {imgSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imgSrc}
            alt=""
            onError={() => void refreshThumb()}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--color-ink-soft)]">
            <ImageOff className="h-6 w-6" aria-hidden="true" />
          </span>
        )}
        {typeof score === "number" && (
          <span
            className="absolute left-2 top-2 inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums shadow-[0_1px_3px_rgba(25,23,20,0.15)]"
            style={{
              background: scoreColors(score).bg,
              color: scoreColors(score).fg,
            }}
          >
            {score.toFixed(1)}
          </span>
        )}
      </Link>

      <div className="flex items-center gap-1 rounded-b-[var(--radius-xl)] bg-white px-3 py-2.5">
        {renaming ? (
          <input
            ref={inputRef}
            value={value}
            autoFocus
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onRenameKey}
            onBlur={() => void saveRename()}
            className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-white px-2 py-1 text-[14px] font-semibold text-[var(--color-ink)] outline-none"
          />
        ) : (
          <div className="min-w-0 flex-1">
            <Link
              href={href}
              prefetch
              className="block truncate text-[14px] font-semibold text-[var(--color-ink)] hover:text-[var(--color-primary)]"
            >
              {name}
            </Link>
            {typeof score === "number" && (
              <span
                className="text-[11.5px] font-medium"
                style={{ color: scoreColors(score).fg }}
              >
                {scoreBand(score)}
              </span>
            )}
            {typeof score !== "number" &&
              (ratingStatus === "queued" || ratingStatus === "scoring") && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--color-primary)]">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Rating…
                </span>
              )}
            {typeof score !== "number" &&
              (ratingStatus === "failed" || ratingStatus === "cancelled") && (
                <span
                  className="block truncate text-[11.5px] font-medium text-[var(--color-weak)]"
                  title={ratingError ?? undefined}
                >
                  {ratingError || "Rating failed"}
                </span>
              )}
            {topFix && (
              <span className="mt-0.5 block truncate text-[11.5px] text-[var(--color-ink-muted)]">
                Fix first: {topFix}
              </span>
            )}
          </div>
        )}

        {!renaming && (
          <button
            type="button"
            aria-label="Product actions"
            onClick={() => setMenuOpen((v) => !v)}
            className={cn(
              "inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[var(--color-ink-soft)] transition-all hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)]",
              "opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100",
              menuOpen && "bg-[var(--color-page-deep)] text-[var(--color-ink)] sm:opacity-100"
            )}
          >
            {busy && !confirming ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <MoreVertical className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {menuOpen && (
        <>
          {/* click-away layer */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-2 top-full z-30 mt-1 w-40 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white py-1 shadow-[var(--shadow-soft-strong)]">
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setValue(name);
                setRenaming(true);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-page-deep)]"
            >
              <Pencil className="h-4 w-4 text-[var(--color-ink-soft)]" aria-hidden="true" />
              Rename
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setConfirming(true);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] font-medium text-[var(--color-weak)] hover:bg-[var(--color-weak-soft)]"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete
            </button>
          </div>
        </>
      )}

      {confirming &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Delete product"
            className="dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,18,16,0.5)] px-4"
            onClick={() => !busy && setConfirming(false)}
          >
            <div
              className="dialog-pop w-full max-w-[400px] rounded-[var(--radius-2xl)] bg-white p-7 shadow-[var(--shadow-soft-strong)]"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-weak-soft)] text-[var(--color-weak)]">
                <Trash2 className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-[19px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">
                Delete {name}?
              </h2>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                This permanently removes the product, its photo, and its rating.
                This cannot be undone.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-3 py-2 text-[13px] text-[var(--color-ink)]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-weak)]" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="inline-flex items-center justify-center rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-weak)] px-5 py-2.5 text-[14px] font-semibold text-white shadow-[0_4px_12px_rgba(189,64,52,0.28)] transition-all hover:brightness-95 active:translate-y-[1px] disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Delete product
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
