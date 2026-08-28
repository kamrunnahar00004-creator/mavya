"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ImageUp,
  Loader2,
  Plus,
  RotateCcw,
  Star,
  X,
} from "lucide-react";
import { prepareUploadImage } from "@/lib/client-image";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import {
  parseRatingQueueResponse,
  ratingQueueErrorMessage,
} from "@/lib/rating-queue";
import {
  batchSubmissionFingerprint,
  batchErrorMessage,
  buildBatchInitPayload,
  hashFile,
  parseBatchSubmissionIdentity,
  parseBatchFinalizeResponse,
  parseBatchInitResponse,
  parseBatchUploadResponse,
  resolveBatchSubmissionIdentity,
  runWithConcurrency,
  withMainFirst,
  type BatchSubmissionIdentity,
  type BatchRole,
} from "@/lib/photo-batch-client";
import { savePendingPhotos, type PendingPhotoItem } from "@/lib/pending-photos";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { trackClientEvent } from "@/lib/track-client";
import { cn } from "@/lib/utils";
import { AnalyzingState } from "@/components/analyzing-state";

type Step = "idle" | "saving";
const MAX_BATCH_FILES = 10;
const BATCH_SESSION_KEY = "mavya:pendingBatch";

type BatchItem = {
  requestId: string;
  file: File;
  hash: string;
  role: BatchRole;
  previewUrl: string;
  status: "preparing" | "ready" | "uploading" | "uploaded" | "failed";
  errorMessage?: string;
};

type PendingBatchFinalization = {
  batchId: string;
  failedRequestIds: string[];
};

/**
 * Add-product card. Single file keeps the original one-step flow entirely
 * unchanged (immediate submit to /api/score/jobs). Selecting 2-10 files
 * opens a preview grid instead: choose the main photo, remove or reorder,
 * then submit the whole batch through /api/photos/batch/*.
 *
 * Auth-aware (optional, opt-in via onGateFailed): when supplied, this is
 * the SAME dropzone the landing page uses for signed-out visitors -- picking
 * photos is free, but submitting them checks session + entitlement FIRST and
 * stashes the pick before checking either gate (never uploads or scores
 * anything when a gate fails). Omitted entirely inside the dashboard, where a
 * session and entitlement are already guaranteed, so existing behavior there
 * is untouched byte-for-byte.
 */
export function AddProductCard({
  variant = "tile",
  onGateFailed,
  resumeSelection,
  onResumed,
}: {
  variant?: "tile" | "hero" | "dropzone";
  /** Fires instead of any submit when the visitor cannot proceed yet. The
   *  pick is already stashed by the time this fires. */
  onGateFailed?: (reason: "unauthenticated" | "subscription_required") => void;
  /** Photos recovered from a pre-auth stash (main first), fed back through
   *  the exact same chooseFiles() path a live pick uses -- 1 photo submits
   *  immediately, 2+ show the same review grid a live multi-pick would.
   *  Consumed once; the parent owns clearing this only after onResumed fires. */
  resumeSelection?: PendingPhotoItem[] | null;
  /** Called only after the selection has become durable on the server, or the
   *  seller explicitly cancels it. Never called merely because recovery began. */
  onResumed?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const appendInputRef = useRef<HTMLInputElement | null>(null);

  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [pendingFinalization, setPendingFinalization] =
    useState<PendingBatchFinalization | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  const busy = step !== "idle" || batchSubmitting || pendingFinalization !== null;
  const dialogRef = useDialogFocus<HTMLDivElement>({
    open: open && step === "idle",
    onClose: close,
    canClose: !busy,
    initialFocusRef: nameInputRef,
  });

  // File objects cannot survive a refresh. A saved identity lets the init
  // request remain idempotent and lets this recovery pass explicitly close
  // any browser-owned uploads that never finished.
  useEffect(() => {
    const pending = parseBatchSubmissionIdentity(sessionStorage.getItem(BATCH_SESSION_KEY));
    if (!pending) {
      sessionStorage.removeItem(BATCH_SESSION_KEY);
      return;
    }
    if (!pending.batchId) {
      sessionStorage.removeItem(BATCH_SESSION_KEY);
      setResumeNotice("A previous upload did not start. Select the photos again to retry.");
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/photos/batch/${pending.batchId}`);
        if (!res.ok) throw new Error("status_failed");
        const body = (await res.json()) as {
          productId?: string | null;
          items?: { requestId?: string; state: string }[];
        };
        const pendingRequestIds = (body.items ?? [])
          .filter((item) => item.state === "pending_upload" && item.requestId)
          .map((item) => item.requestId as string);
        const finalizeRes = await fetch(`/api/photos/batch/${pending.batchId}/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ failedRequestIds: pendingRequestIds }),
        });
        if (!finalizeRes.ok) throw new Error("finalize_failed");
        const finalized = parseBatchFinalizeResponse(await finalizeRes.json().catch(() => null));
        if (!finalized.ok) throw new Error("finalize_failed");
        sessionStorage.removeItem(BATCH_SESSION_KEY);
        const productId = finalized.productId;
        if (productId) {
          setResumeNotice(
            pendingRequestIds.length > 0
              ? `A previous batch was interrupted. ${pendingRequestIds.length} photo${pendingRequestIds.length === 1 ? "" : "s"} were not uploaded. Add them from the product.`
              : "A previous batch finished after the page was refreshed."
          );
          onResumed?.();
          router.push(`/dashboard/product/${productId}`);
        } else {
          setResumeNotice("The previous batch did not save any photos. Select them again to retry.");
        }
      } catch {
        setResumeNotice("A previous upload still needs attention. Refresh to retry recovery.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Photos recovered from a pre-auth stash (landing page only, via
  // resumeSelection). Attempted once per recovered selection, through the SAME chooseFiles()
  // path a live pick uses -- recovery can never diverge from what a live
  // pick would do with the same files in the same order (1 submits
  // immediately, 2+ show the same review grid).
  const resumedRef = useRef<PendingPhotoItem[] | null>(null);
  useEffect(() => {
    if (!resumeSelection || resumeSelection.length === 0) {
      resumedRef.current = null;
      return;
    }
    if (resumedRef.current === resumeSelection) return;
    resumedRef.current = resumeSelection;
    void chooseFiles(resumeSelection.map((item) => item.file));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSelection]);

  function reset() {
    setName("");
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setDragActive(false);
    setStep("idle");
    setError(null);
    clearBatch();
  }

  function clearBatch() {
    sessionStorage.removeItem(BATCH_SESSION_KEY);
    setBatch((old) => {
      old?.forEach((b) => URL.revokeObjectURL(b.previewUrl));
      return null;
    });
    setBatchSubmitting(false);
    setBatchProgress({ done: 0, total: 0 });
    setPendingFinalization(null);
  }

  function cancelBatchSelection() {
    clearBatch();
    onResumed?.();
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

      onResumed?.();
      router.push(`/dashboard/product/${queued.productId}`);
    } catch (err) {
      setStep("idle");
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  /** `append` adds to the batch already on screen instead of replacing it,
   *  which is what the grid's "Add more photos" needs -- without it a seller
   *  who dropped below two usable photos had no route forward except
   *  discarding the whole selection. */
  async function chooseFiles(
    fileList: FileList | File[],
    options?: { append?: boolean }
  ) {
    const append = options?.append === true;
    const existing = append ? batch ?? [] : [];
    if (busy) return;
    const files = Array.from(fileList);
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) {
      setError("Choose an image file (JPG or PNG).");
      return;
    }

    // Gate the paid work, not the pick (landing-page use only, via
    // onGateFailed). Stash before even reading auth so an expired session
    // refresh, billing outage, OAuth redirect, or checkout round-trip cannot
    // lose the files. Nothing uploads or scores until both gates pass.
    if (onGateFailed) {
      const selectedForRecovery: PendingPhotoItem[] = append
        ? [
            ...existing.map((item) => ({ file: item.file, role: item.role })),
            ...images.map((file) => ({
              file,
              role: "supporting" as const,
            })),
          ]
        : images.map((file, i) => ({
            file,
            role: i === 0 ? ("main" as const) : ("supporting" as const),
          }));
      const items = selectedForRecovery.slice(0, MAX_BATCH_FILES);
      const { durable } = await savePendingPhotos(items);
      const stashWarnings = [
        selectedForRecovery.length > MAX_BATCH_FILES
          ? `Only the first ${MAX_BATCH_FILES} photos were kept.`
          : null,
        durable
          ? null
          : "Private browsing cannot keep your photos through sign-in. You may need to select them again afterward.",
      ].filter(Boolean);
      setError(stashWarnings.length > 0 ? stashWarnings.join(" ") : null);

      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        onGateFailed("unauthenticated");
        return;
      }
      try {
        const res = await fetch("/api/billing/status");
        if (!res.ok) {
          setError("Billing status could not be checked. Try again.");
          return;
        }
        const body = (await res.json()) as { active?: boolean };
        if (body.active !== true) {
          onGateFailed("subscription_required");
          return;
        }
      } catch {
        setError("Billing status could not be checked. Try again.");
        return;
      }
    }

    // Landing-flow-only funnel signal (onGateFailed presence marks this
    // instance as the pre-auth landing dropzone): fires once we know a real
    // submit is about to happen -- a live already-entitled pick, or a
    // recovered pick resuming after sign-in/checkout. Never fires for the
    // authenticated dashboard's own product-add flow.
    if (onGateFailed) trackClientEvent("photo_uploaded");

    if (images.length === 1 && !append) {
      setError(null);
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(images[0]);
      });
      void handleCreate(images[0]);
      return;
    }

    const room = MAX_BATCH_FILES - existing.length;
    if (append && room <= 0) {
      setError(`You can rate up to ${MAX_BATCH_FILES} photos at once.`);
      return;
    }
    let kept = images;
    if (kept.length > room) {
      kept = kept.slice(0, room);
      setError(`Only the first ${MAX_BATCH_FILES} photos were kept.`);
    } else {
      setError(null);
    }

    const prepared: BatchItem[] = kept.map((file, i) => ({
      requestId: crypto.randomUUID(),
      file,
      hash: "",
      // Appended photos are always supporting: the existing selection already
      // has a main, and silently reassigning it would undo the seller's pick.
      role: !append && i === 0 ? "main" : "supporting",
      previewUrl: URL.createObjectURL(file),
      status: "preparing",
    }));
    setBatch([...existing, ...prepared]);

    // Seed with the hashes already in the grid so an appended photo is caught
    // as a duplicate of one the seller picked earlier, not just of its own batch.
    const seenHashes: string[] = existing
      .map((item) => item.hash)
      .filter((hash): hash is string => Boolean(hash));
    for (const item of prepared) {
      try {
        const readyFile = await prepareUploadImage(item.file);
        const hash = await hashFile(readyFile);
        const isDuplicate = seenHashes.includes(hash);
        seenHashes.push(hash);
        setBatch((old) =>
          old?.map((b) =>
            b.requestId === item.requestId
              ? {
                  ...b,
                  file: readyFile,
                  hash,
                  status: isDuplicate ? "failed" : "ready",
                  errorMessage: isDuplicate ? "Same photo as another one selected" : undefined,
                }
              : b
          ) ?? old
        );
      } catch (err) {
        setBatch((old) =>
          old?.map((b) =>
            b.requestId === item.requestId
              ? {
                  ...b,
                  status: "failed",
                  errorMessage:
                    err instanceof Error ? err.message : "Could not prepare this photo",
                }
              : b
          ) ?? old
        );
      }
    }
  }

  function removeBatchItem(requestId: string) {
    setBatch((old) => {
      if (!old) return old;
      const removed = old.find((b) => b.requestId === requestId);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const rest = old.filter((b) => b.requestId !== requestId);
      if (removed?.role === "main" && rest.length > 0) {
        rest[0] = { ...rest[0], role: "main" };
      }
      return rest;
    });
  }

  function setMain(requestId: string) {
    setBatch(
      (old) => old?.map((b) => ({ ...b, role: b.requestId === requestId ? "main" : "supporting" })) ?? old
    );
  }

  function moveItem(requestId: string, direction: -1 | 1) {
    setBatch((old) => {
      if (!old) return old;
      const index = old.findIndex((b) => b.requestId === requestId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= old.length) return old;
      const next = [...old];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function finishBatch(pending: PendingBatchFinalization) {
    const finalizeRes = await fetch(`/api/photos/batch/${pending.batchId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ failedRequestIds: pending.failedRequestIds }),
    });
    if (!finalizeRes.ok) {
      throw new Error(
        batchErrorMessage(await finalizeRes.json().catch(() => null), finalizeRes.status)
      );
    }
    const finalized = parseBatchFinalizeResponse(
      await finalizeRes.json().catch(() => null)
    );
    if (!finalized.ok) throw new Error(finalized.message);

    sessionStorage.removeItem(BATCH_SESSION_KEY);
    setPendingFinalization(null);
    if (!finalized.productId) {
      setBatchSubmitting(false);
      setError("None of these photos could be saved. Try again.");
      return;
    }
    onResumed?.();
    router.push(`/dashboard/product/${finalized.productId}`);
  }

  async function submitBatch() {
    if (!batch || batchSubmitting) return;
    if (pendingFinalization) {
      setBatchSubmitting(true);
      setError(null);
      try {
        await finishBatch(pendingFinalization);
      } catch (err) {
        setBatchSubmitting(false);
        setError(err instanceof Error ? err.message : "Could not finish this batch. Try again.");
      }
      return;
    }
    const usable = batch.filter((b) => b.status !== "failed" && b.hash);
    if (usable.length < 2) {
      setError("Select at least 2 different photos.");
      return;
    }
    const normalizedUsable = usable.some((b) => b.role === "main")
      ? usable
      : usable.map((item, index) => ({
          ...item,
          role: index === 0 ? ("main" as const) : ("supporting" as const),
        }));

    setBatchSubmitting(true);
    setError(null);
    setBatchProgress({ done: 0, total: normalizedUsable.length });

    try {
      const selected = normalizedUsable.map((b) => ({
        requestId: b.requestId,
        file: b.file,
        role: b.role,
        contentHash: b.hash,
      }));
      const fingerprint = batchSubmissionFingerprint(selected, name);
      const previous = parseBatchSubmissionIdentity(sessionStorage.getItem(BATCH_SESSION_KEY));
      const identity = resolveBatchSubmissionIdentity(previous, fingerprint, () => crypto.randomUUID());
      sessionStorage.setItem(BATCH_SESSION_KEY, JSON.stringify(identity));

      const initRes = await fetch("/api/photos/batch/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBatchInitPayload(selected, identity.idempotencyKey, name.trim())),
      });
      if (!initRes.ok) {
        throw new Error(batchErrorMessage(await initRes.json().catch(() => null), initRes.status));
      }
      const init = parseBatchInitResponse(await initRes.json().catch(() => null));
      if (!init.ok) throw new Error(init.message);

      // Narrowed fields extracted into plain consts: TypeScript does not
      // preserve discriminated-union narrowing of `init` into the nested
      // closures below.
      const batchId = init.batchId;
      const startedIdentity: BatchSubmissionIdentity = { ...identity, batchId };
      sessionStorage.setItem(BATCH_SESSION_KEY, JSON.stringify(startedIdentity));

      const byRequestId = new Map(normalizedUsable.map((u) => [u.requestId, u]));
      const ordered = withMainFirst(normalizedUsable);
      const failedRequestIds = new Set<string>();

      let done = 0;
      async function uploadOne(item: BatchItem): Promise<boolean> {
        setBatch((old) =>
          old?.map((b) => (b.requestId === item.requestId ? { ...b, status: "uploading" } : b)) ?? old
        );
        try {
          const form = new FormData();
          form.set("batch_id", batchId);
          form.set("request_id", item.requestId);
          form.set("image", item.file);
          const res = await fetch("/api/photos/batch/upload", { method: "POST", body: form });
          const body = await res.json().catch(() => null);
          if (!res.ok) {
            const message = batchErrorMessage(body, res.status);
            setBatch((old) =>
              old?.map((b) =>
                b.requestId === item.requestId ? { ...b, status: "failed", errorMessage: message } : b
              ) ?? old
            );
            failedRequestIds.add(item.requestId);
            return false;
          }
          const parsed = parseBatchUploadResponse(item.requestId, body);
          if (!parsed.ok) {
            setBatch((old) =>
              old?.map((b) =>
                b.requestId === item.requestId
                  ? { ...b, status: "failed", errorMessage: parsed.message }
                  : b
              ) ?? old
            );
            failedRequestIds.add(item.requestId);
            return false;
          }
          setBatch((old) =>
            old?.map((b) => (b.requestId === item.requestId ? { ...b, status: "uploaded" } : b)) ?? old
          );
          return true;
        } catch {
          setBatch((old) =>
            old?.map((b) =>
              b.requestId === item.requestId
                ? { ...b, status: "failed", errorMessage: "Upload failed. Try again." }
                : b
              ) ?? old
          );
          failedRequestIds.add(item.requestId);
          return false;
        } finally {
          done += 1;
          setBatchProgress({ done, total: normalizedUsable.length });
        }
      }

      // Declared main uploads first, alone, awaited -- this is what lets
      // server-side promotion (resolve_batch_item_role) know for certain
      // whether the main failed before any supporting item is persisted.
      const [firstMain, ...rest] = ordered;
      const mainUploaded = firstMain
        ? await uploadOne(byRequestId.get(firstMain.requestId) ?? firstMain)
        : false;

      let remaining = rest;
      if (!mainUploaded) {
        // Only one supporting upload may race for promotion to main. Once
        // one succeeds, the remaining items are safe to upload concurrently.
        for (let index = 0; index < rest.length; index += 1) {
          const candidate = rest[index];
          const uploaded = await uploadOne(byRequestId.get(candidate.requestId) ?? candidate);
          if (uploaded) {
            remaining = rest.slice(index + 1);
            break;
          }
          remaining = [];
        }
      }
      if (remaining.length > 0) {
        await runWithConcurrency(remaining, 2, async (item) => {
          await uploadOne(byRequestId.get(item.requestId) ?? item);
        });
      }

      const pending = { batchId, failedRequestIds: [...failedRequestIds] };
      setPendingFinalization(pending);
      await finishBatch(pending);
    } catch (err) {
      setBatchSubmitting(false);
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  const dropHandlers = {
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (!busy) setDragActive(true);
    },
    onDragLeave: () => setDragActive(false),
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      if (busy) return;
      if (e.dataTransfer.files?.length) void chooseFiles(e.dataTransfer.files);
    },
  };

  const showBatchGrid = Boolean(batch);

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
          {!showBatchGrid ? (
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload listing photos"
              onClick={() => !busy && inputRef.current?.click()}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !busy) {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              {...dropHandlers}
              className={cn(
                "group flex min-h-[400px] cursor-pointer flex-col items-center justify-center gap-6 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white px-8 py-16 text-center shadow-[var(--shadow-soft)] transition-all",
                "hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-soft-strong)]",
                dragActive && "dropzone-active",
                busy && "pointer-events-none opacity-70"
              )}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
                <ImageUp className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span>
                <span className="block text-[19px] font-bold tracking-[-0.01em] text-[var(--color-ink)]">
                  Drop all your listing photos here
                </span>
                <span className="mt-1.5 block text-[13.5px] text-[var(--color-ink-muted)]">
                  Up to 10 photos. All photos must be from the same listing.
                </span>
              </span>
              <span className="rounded-full bg-[var(--color-primary)] px-8 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all group-hover:bg-[var(--color-primary-hover)]">
                Choose files
              </span>
            </div>
          ) : (
            <BatchGrid
              batch={batch!}
              submitting={batchSubmitting}
              finalizationPending={pendingFinalization !== null}
              progress={batchProgress}
              onRemove={removeBatchItem}
              onSetMain={setMain}
              onMove={moveItem}
              onSubmit={submitBatch}
              onCancel={cancelBatchSelection}
              onAddMore={() => appendInputRef.current?.click()}
            />
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void chooseFiles(e.target.files);
              e.target.value = "";
            }}
          />
          {resumeNotice && (
            <div className="mt-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-page-deep)] px-3 py-2 text-left text-[13px] text-[var(--color-ink-muted)]">
              {resumeNotice}
            </div>
          )}
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
        // Same overall shape as ProductCard (square media area + a footer
        // text strip below it, same rounded-xl/white/border language) so
        // this tile reads as one more card in the row, not a shorter,
        // different-shaped placeholder next to real listings.
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex flex-col overflow-hidden rounded-[var(--radius-xl)] border border-dashed border-[var(--color-border-strong)] bg-white text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-soft-strong)]"
        >
          <span className="flex aspect-square w-full items-center justify-center bg-[var(--color-page-deep)]/50 transition-colors duration-200 group-hover:bg-[var(--color-tint)]">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)] transition-transform duration-200 group-hover:scale-105">
              <Plus className="h-6 w-6" aria-hidden="true" />
            </span>
          </span>
          <span className="flex flex-col gap-0.5 rounded-b-[var(--radius-xl)] bg-white px-3 py-2.5">
            <span className="text-[14px] font-semibold text-[var(--color-ink)] group-hover:text-[var(--color-primary)]">
              Add product
            </span>
            <span className="text-[11.5px] text-[var(--color-ink-muted)]">
              Upload listing photos, get scored
            </span>
          </span>
        </button>
      )}

      {busy &&
        step === "saving" &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-50 overflow-auto bg-[var(--color-page)]">
            <AnalyzingState imageSrc={previewUrl ?? undefined} imageAlt="" />
          </div>,
          document.body
        )}

      {open &&
        step === "idle" &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add product"
            className="fixed inset-0 z-50 flex items-center justify-center overflow-auto bg-[rgba(15,13,11,0.55)] px-4 py-8 backdrop-blur-sm"
            onClick={close}
          >
            <div
              ref={dialogRef}
              className={cn(
                "relative w-full rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-7 shadow-[var(--shadow-soft-strong)] sm:p-8",
                showBatchGrid ? "max-w-[720px]" : "max-w-[480px]"
              )}
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
                Name it and upload your listing photos.
              </p>

              <label className="mt-6 block">
                <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--color-ink-muted)]">
                  Name (optional)
                </span>
                <input
                  ref={nameInputRef}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  placeholder="e.g. Pink leaf candle"
                  className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
                />
              </label>

              <div className="mt-5">
                {!showBatchGrid ? (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label="Upload listing photos"
                    onClick={() => !busy && inputRef.current?.click()}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && !busy) {
                        e.preventDefault();
                        inputRef.current?.click();
                      }
                    }}
                    {...dropHandlers}
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
                            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                          </span>
                        )}
                        <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-[var(--color-ink)]">
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Saving…
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
                          <ImageUp className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
                        </span>
                        <span>
                          <span className="block text-[16px] font-semibold text-[var(--color-ink)]">
                            Drop your listing photos
                          </span>
                          <span className="mt-1 block text-[13px] text-[var(--color-ink-muted)]">
                            Add 1 photo, or up to 10 at once. JPG or PNG.
                          </span>
                        </span>
                        <span className="rounded-full bg-[var(--color-primary)] px-7 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all group-hover:bg-[var(--color-primary-hover)]">
                          Score listing photos
                        </span>
                      </>
                    )}
                  </div>
                ) : (
                  <BatchGrid
                    batch={batch!}
                    submitting={batchSubmitting}
                    finalizationPending={pendingFinalization !== null}
                    progress={batchProgress}
                    onRemove={removeBatchItem}
                    onSetMain={setMain}
                    onMove={moveItem}
                    onSubmit={submitBatch}
                    onCancel={cancelBatchSelection}
                    onAddMore={() => appendInputRef.current?.click()}
                  />
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) void chooseFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                {/* Separate input so "Add more photos" extends the current
                    selection rather than replacing it. */}
                <input
                  ref={appendInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files?.length) {
                      void chooseFiles(e.target.files, { append: true });
                    }
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

/** Preview grid for a 2-10 photo batch: main selector, remove, reorder, and
 *  per-photo upload state once submitted. */
function BatchGrid({
  batch,
  submitting,
  finalizationPending,
  progress,
  onRemove,
  onSetMain,
  onMove,
  onSubmit,
  onCancel,
  onAddMore,
}: {
  batch: BatchItem[];
  submitting: boolean;
  finalizationPending: boolean;
  progress: { done: number; total: number };
  onRemove: (requestId: string) => void;
  onSetMain: (requestId: string) => void;
  onMove: (requestId: string, direction: -1 | 1) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onAddMore: () => void;
}) {
  const allReady = batch.every((b) => b.status === "ready" || b.status === "failed");
  const usableCount = batch.filter((b) => b.status !== "failed").length;

  return (
    <div>
      <div
        role="list"
        aria-label="Selected photos"
        className="grid grid-cols-3 gap-3 sm:grid-cols-4"
      >
        {batch.map((item, index) => (
          <div
            key={item.requestId}
            role="listitem"
            className={cn(
              "group relative aspect-square overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-page-deep)]",
              item.role === "main" ? "border-[var(--color-primary)] ring-2 ring-[var(--color-tint-deep)]" : "border-[var(--color-border)]",
              item.status === "failed" && "opacity-60"
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.previewUrl}
              alt={`Selected photo ${index + 1}`}
              className="h-full w-full object-cover"
            />

            {item.role === "main" && (
              <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[10.5px] font-semibold text-white">
                <Star className="h-3 w-3" aria-hidden="true" />
                Main
              </span>
            )}

            {(item.status === "preparing" || item.status === "uploading") && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/35">
                <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden="true" />
              </span>
            )}
            {item.status === "uploaded" && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/25">
                <span className="rounded-full bg-white px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-ink)]">
                  Saved
                </span>
              </span>
            )}
            {item.status === "failed" && (
              <span className="absolute inset-x-0 bottom-0 truncate bg-[var(--color-weak)] px-1.5 py-1 text-[10.5px] font-medium text-white">
                {item.errorMessage ?? "Failed"}
              </span>
            )}

            {!submitting && !finalizationPending && (
              <>
                <button
                  type="button"
                  onClick={() => onRemove(item.requestId)}
                  aria-label={`Remove photo ${index + 1}`}
                  title="Remove"
                  className="absolute right-1.5 top-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {item.role !== "main" && item.status !== "failed" && (
                  <button
                    type="button"
                    onClick={() => onSetMain(item.requestId)}
                    aria-label={`Set photo ${index + 1} as main`}
                    title="Set as main"
                    className="absolute bottom-1.5 left-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                  >
                    <Star className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                <div className="absolute bottom-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => onMove(item.requestId, -1)}
                    disabled={index === 0}
                    aria-label={`Move photo ${index + 1} earlier`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(item.requestId, 1)}
                    disabled={index === batch.length - 1}
                    aria-label={`Move photo ${index + 1} later`}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
            {submitting && item.status === "failed" && (
              <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting || finalizationPending}
          className="text-[13.5px] font-semibold text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
        >
          Start over
        </button>
        {submitting ? (
          <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-[var(--color-ink)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {finalizationPending
              ? "Finishing upload…"
              : `Saving ${progress.done} of ${progress.total}…`}
          </span>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3">
            {/* The submit button is disabled below two usable photos, and the
                explanation used to live only inside submitBatch -- which a
                disabled button can never call, so the seller saw a greyed-out
                "Rate 1 photo" with a red badge and no instruction. Selecting
                the same file twice is an easy picker mistake, and the grid
                had no way to add more, so Start over was the only exit.
                Say why, and offer the way forward. */}
            {!finalizationPending && allReady && usableCount < 2 && (
              <span className="text-[13px] text-[var(--color-ink-muted)]">
                Add at least 2 different photos to rate them together.
              </span>
            )}
            {!finalizationPending && (
              <button
                type="button"
                onClick={onAddMore}
                disabled={!allReady}
                className="rounded-full border border-[var(--color-border)] bg-white px-5 py-3 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add more photos
              </button>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={!finalizationPending && (!allReady || usableCount < 2)}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-7 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {finalizationPending
                ? "Finish upload"
                : `Rate ${usableCount} photo${usableCount === 1 ? "" : "s"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
