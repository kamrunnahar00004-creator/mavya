"use client";

import { useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertCircle, ImageUp, Loader2, Plus, X } from "lucide-react";
import { prepareUploadImage } from "@/lib/client-image";
import {
  parseRatingQueueResponse,
  ratingQueueErrorMessage,
} from "@/lib/rating-queue";
import { cn } from "@/lib/utils";
import { AnalyzingState } from "@/components/analyzing-state";

type Step = "idle" | "saving";

/**
 * Add-product card. Opens a small dialog (name optional + photo), runs the
 * durable scoring pipeline. The server persists the product + photo first,
 * then the dashboard card keeps polling while the rating finishes.
 */
export function AddProductCard({
  variant = "tile",
}: {
  variant?: "tile" | "hero" | "dropzone";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
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
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    // One-step like the landing: uploading the photo runs the rating immediately.
    void handleCreate(f);
  }

  function reset() {
    setName("");
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

  async function handleCreate(f: File) {
    if (busy) return;
    setError(null);
    try {
      const prepared = await prepareUploadImage(f);

      // Persist first, then let the durable server worker own scoring. Once
      // this request returns, navigation cannot interrupt the rating.
      setStep("saving");
      const form = new FormData();
      form.set("image", prepared);
      form.set("request_id", crypto.randomUUID());
      form.set("role", "main");
      form.set("name", name.trim());
      const res = await fetch("/api/score/jobs", { method: "POST", body: form });
      if (!res.ok) {
        throw new Error(
          ratingQueueErrorMessage(await res.json().catch(() => null), res.status)
        );
      }
      const queued = parseRatingQueueResponse(await res.json().catch(() => null));
      if (!queued.ok) throw new Error(queued.message);

      // The durable server job owns the rating from here. Go STRAIGHT to the
      // product page: it renders the analyzing state while the job runs and
      // reveals the audit the moment it lands. The full-screen analyzing
      // overlay stays up THROUGH the navigation (this component unmounts on
      // route change), so the dashboard never flashes underneath.
      router.push(`/dashboard/product/${queued.productId}`);
    } catch (err) {
      setStep("idle");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  return (
    <>
      {variant === "hero" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_14px_rgba(232,107,57,0.32)] transition-all hover:bg-[var(--color-primary-hover)] hover:shadow-[0_8px_20px_rgba(216,91,44,0.36)] active:translate-y-[1px]"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
          Rate my thumbnail
        </button>
      ) : variant === "dropzone" ? (
        <div className="w-full">
          {/* Inline drag-and-drop card (no modal): drop or click to score a
              thumbnail in one step. The full-screen analyzing overlay below
              takes over while the durable rating runs. */}
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
              "group flex min-h-[256px] cursor-pointer flex-col items-center justify-center gap-4 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white px-6 py-9 text-center shadow-[var(--shadow-soft)] transition-all",
              "hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-soft-strong)]",
              dragActive && "dropzone-active",
              busy && "pointer-events-none opacity-70"
            )}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
              <ImageUp className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[17px] font-bold text-[var(--color-ink)]">
                Drop your thumbnail here
              </span>
              <span className="mt-1 block text-[13px] text-[var(--color-ink-muted)]">
                JPG or PNG, and your photo stays private
              </span>
            </span>
            <span className="rounded-full bg-[var(--color-primary)] px-7 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all group-hover:bg-[var(--color-primary-hover)]">
              Score My Thumbnail
            </span>
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
          {error && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-3 py-2 text-left text-[13px] text-[var(--color-ink)]"
            >
              <AlertCircle
                className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-weak)]"
                aria-hidden="true"
              />
              <span>{error}</span>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border-strong)] bg-white/40 text-[var(--color-ink-soft)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:bg-[var(--color-tint)] hover:shadow-[var(--shadow-soft)]"
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)] transition-transform duration-200 group-hover:scale-105">
            <Plus className="h-6 w-6" aria-hidden="true" />
          </span>
          <span className="text-[13.5px] font-semibold text-[var(--color-ink-muted)] group-hover:text-[var(--color-primary)]">
            Add product
          </span>
        </button>
      )}

      {/* While scoring/saving, take over the full screen with the same analyzing
          experience as the landing, then navigate to the product page. */}
      {busy &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 overflow-auto bg-[var(--color-page)]">
            <AnalyzingState imageSrc={previewUrl ?? undefined} imageAlt="" />
          </div>,
          document.body
        )}

      {open &&
        !busy &&
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
              className="relative w-full max-w-[480px] rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-7 shadow-[var(--shadow-soft-strong)] sm:p-8"
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
              <p className="mt-1.5 text-[14px] text-[var(--color-ink-muted)]">
                Name it and upload the listing thumbnail.
              </p>

              <label className="mt-6 block">
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

              <div className="mt-5">
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
                    "group flex min-h-[232px] cursor-pointer flex-col items-center justify-center gap-4 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white px-6 py-8 text-center shadow-[var(--shadow-soft)] transition-all",
                    "hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-soft-strong)]",
                    dragActive && "dropzone-active",
                    busy && "pointer-events-none opacity-70"
                  )}
                >
                  {busy ? (
                    <>
                      {previewUrl && (
                        <span className="h-28 w-28 overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-page-deep)] shadow-[var(--shadow-soft)]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={previewUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </span>
                      )}
                      <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-[var(--color-ink)]">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {step === "saving" ? "Saving…" : "Rating photo…"}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
                        <ImageUp className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block text-[16px] font-semibold text-[var(--color-ink)]">
                          Drop your listing thumbnail
                        </span>
                        <span className="mt-1 block text-[13px] text-[var(--color-ink-muted)]">
                          JPG or PNG
                        </span>
                      </span>
                      <span className="rounded-full bg-[var(--color-primary)] px-7 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all group-hover:bg-[var(--color-primary-hover)]">
                        Upload photo
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
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
