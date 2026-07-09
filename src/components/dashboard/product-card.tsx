"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
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
};

/**
 * One product tile in the dashboard grid. Thumbnail + name link to the product's
 * rating; a hover kebab menu offers Rename (inline) and Delete (confirmed,
 * danger-styled). All writes run under the user's RLS.
 */
export function ProductCard({ id, name, thumbnailUrl }: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(name);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    <div className="group relative flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-white shadow-[0_1px_2px_rgba(25,23,20,0.04)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-soft-strong)]">
      <a
        href={href}
        aria-label={`Open ${name}`}
        className="relative block aspect-square w-full overflow-hidden bg-[var(--color-page-deep)]"
      >
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[var(--color-ink-soft)]">
            <ImageOff className="h-6 w-6" aria-hidden="true" />
          </span>
        )}
      </a>

      <div className="flex items-center gap-1 px-3 py-2.5">
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
          <a
            href={href}
            className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--color-ink)] hover:text-[var(--color-primary)]"
          >
            {name}
          </a>
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
          <div className="absolute right-2 top-[calc(100%-46px)] z-20 w-40 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white py-1 shadow-[var(--shadow-soft-strong)]">
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,13,11,0.55)] px-4 backdrop-blur-sm"
            onClick={() => !busy && setConfirming(false)}
          >
            <div
              className="w-full max-w-[380px] rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft-strong)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-weak-soft)] text-[var(--color-weak)]">
                  <Trash2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-[17px] font-bold text-[var(--color-ink)]">
                    Delete {name}?
                  </h2>
                  <p className="mt-1 text-[13.5px] leading-snug text-[var(--color-ink-muted)]">
                    This removes the product, its photo, and its rating. This cannot
                    be undone.
                  </p>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-3 py-2 text-[13px] text-[var(--color-ink)]"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-weak)]" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <div className="mt-5 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="rounded-full px-4 py-2 text-[14px] font-semibold text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--color-weak)] px-5 py-2 text-[14px] font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Delete
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
