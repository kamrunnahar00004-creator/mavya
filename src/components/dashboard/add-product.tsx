"use client";

import { useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, ImageUp, Loader2, Plus, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { prepareUploadImage } from "@/lib/client-image";
import { cn } from "@/lib/utils";
import type { RubricJson } from "@/lib/rubric";

type Step = "idle" | "scoring" | "saving";

/**
 * Add-product card. Opens a small dialog (name optional + photo), runs the
 * EXISTING scoring pipeline (/api/score), then persists product + main photo
 * (Storage) + audit under the user's RLS, and opens the new product.
 */
export function AddProductCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const busy = step !== "idle";

  function chooseFile(f: File) {
    if (!f.type.startsWith("image/")) {
      setError("Choose an image file (JPG or PNG).");
      return;
    }
    setError(null);
    setFile(f);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
  }

  function reset() {
    setName("");
    setFile(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setDragActive(false);
    setStep("idle");
    setError(null);
  }

  function close() {
    if (busy) return;
    reset();
    setOpen(false);
  }

  async function handleCreate() {
    if (!file || busy) return;
    setError(null);
    try {
      const prepared = await prepareUploadImage(file);

      // 1. Score with the existing pipeline. Reject invalid before creating anything.
      setStep("scoring");
      const form = new FormData();
      form.set("image", prepared);
      const res = await fetch("/api/score", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Scoring failed (${res.status})`);
      }
      const { rubric } = (await res.json()) as { rubric: RubricJson };
      if (rubric.upload_kind === "invalid") {
        setStep("idle");
        setError("That image is not a product photo. Try another.");
        return;
      }

      // 2. Persist product + photo (Storage) + audit under RLS.
      setStep("saving");
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session expired. Log in again.");

      const { data: product, error: pErr } = await supabase
        .from("products")
        .insert({ user_id: user.id, name: name.trim() || null })
        .select("id")
        .single();
      if (pErr || !product) throw new Error(pErr?.message || "Could not create product.");

      const ext = prepared.type === "image/png" ? "png" : "jpg";
      const photoId = crypto.randomUUID();
      const path = `${user.id}/${product.id}/${photoId}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("product-photos")
        .upload(path, prepared, { contentType: prepared.type });
      if (upErr) throw new Error(upErr.message);

      const { error: phErr } = await supabase.from("photos").insert({
        id: photoId,
        product_id: product.id,
        role: "main",
        storage_path: path,
        mime: prepared.type,
      });
      if (phErr) throw new Error(phErr.message);

      const { error: aErr } = await supabase.from("audits").insert({
        photo_id: photoId,
        kind: "main",
        rubric,
        overall_score: rubric.overall_score,
      });
      if (aErr) throw new Error(aErr.message);

      router.push(`/dashboard/product/${product.id}`);
    } catch (err) {
      setStep("idle");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border-strong)] text-[var(--color-ink-soft)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-tint)] hover:text-[var(--color-primary)]"
      >
        <Plus className="h-7 w-7" aria-hidden="true" />
        <span className="text-[13.5px] font-semibold">Add product</span>
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add product"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,13,11,0.55)] px-4 py-8 backdrop-blur-sm"
            onClick={close}
          >
            <div
              className="relative w-full max-w-[440px] rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft-strong)]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                disabled={busy}
                className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)] disabled:opacity-50"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>

              <h2 className="text-[22px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">
                Add a product
              </h2>
              <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">
                Name it and upload the listing thumbnail.
              </p>

              <label className="mt-5 block">
                <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--color-ink-muted)]">
                  Name (optional)
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  placeholder="e.g. Pink leaf candle"
                  className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                />
              </label>

              <div className="mt-4">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload listing thumbnail"
                  onClick={() => !busy && inputRef.current?.click()}
                  onKeyDown={(e) => {
                    if ((e.key === "Enter" || e.key === " ") && !busy) {
                      e.preventDefault();
                      inputRef.current?.click();
                    }
                  }}
                  onDragOver={(e: DragEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    if (!busy) setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e: DragEvent<HTMLDivElement>) => {
                    e.preventDefault();
                    setDragActive(false);
                    if (busy) return;
                    const f = e.dataTransfer.files?.[0];
                    if (f) chooseFile(f);
                  }}
                  className={cn(
                    "group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white px-5 py-6 text-center shadow-[var(--shadow-soft)] transition-all",
                    "hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-soft-strong)]",
                    dragActive && "dropzone-active",
                    busy && "pointer-events-none opacity-70"
                  )}
                >
                  {previewUrl ? (
                    <>
                      <span className="h-24 w-24 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-page-deep)]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </span>
                      <span className="text-[13px] font-semibold text-[var(--color-primary)]">
                        Change thumbnail
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
                        <ImageUp className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block text-[16px] font-semibold text-[var(--color-ink)]">
                          Drop your listing thumbnail
                        </span>
                        <span className="mt-0.5 block text-[13px] text-[var(--color-ink-muted)]">
                          JPG or PNG
                        </span>
                      </span>
                    </>
                  )}
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) chooseFile(f);
                    e.target.value = "";
                  }}
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-3 py-2 text-[13px] text-[var(--color-ink)]"
                >
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-weak)]"
                    aria-hidden="true"
                  />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleCreate}
                disabled={!file || busy}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {step === "scoring"
                  ? "Rating photo…"
                  : step === "saving"
                  ? "Saving…"
                  : "Rate & save"}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
