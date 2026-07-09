"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { AuditWorkspace } from "@/components/audit-workspace";
import type { SlotView } from "@/components/photo-slot-strip";
import {
  rubricToAuditResult,
  rubricToDemoState,
  rubricToSupportingAuditResult,
  rubricToSupportingState,
} from "@/lib/audit-mapping";
import type { AuditResult, DemoState } from "@/data/demo-states";
import type { RubricJson, SupportingPhotoChecklistItem } from "@/lib/rubric";
import type { FidelityReport } from "@/lib/fidelity";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { prepareUploadImage, compressDataUrlForUpload } from "@/lib/client-image";
import { trackClientEvent } from "@/lib/track-client";

export type InitialPhoto = {
  id: string;
  role: "main" | "supporting";
  imageSrc: string;
  rubric: RubricJson;
};

type Props = {
  productId: string;
  userId: string;
  productName: string | null;
  initialPhotos: InitialPhoto[];
};

type RevertSnap = {
  improvedSrc?: string;
  improvedAudit?: AuditResult;
  improvedScore?: number;
  improvedVerdict?: string;
  improvedDownloadUrl?: string;
  freePreview?: boolean;
  freePreviewMessage?: string;
};

type Photo = {
  id: string;
  kind: "main" | "supporting";
  imageSrc: string;
  audit: DemoState;
  status: "analyzing" | "graded";
  isDigital: boolean;
  supportingRole?: string;
  productSummary?: string;
  improveStatus: "idle" | "generating" | "error";
  improveStartedAt?: number;
  improveError?: string;
  improvedDownloadUrl?: string;
  freePreview: boolean;
  freePreviewMsg?: string;
  canRetry: boolean;
  unresolved: string[] | null;
  revertSnap: RevertSnap | null;
};

type GenerateSuccessBody = {
  ok: true;
  outcome: "publish_ready" | "useful_free_preview";
  previewBase64: string;
  previewMimeType: string;
  candidateAudit: RubricJson;
  fidelity: FidelityReport;
};
type GenerateFailureBody = {
  ok: false;
  code: string;
  message: string;
  unresolvedIssues?: string[];
};

const FREE_PREVIEW_PREFIX =
  "This version is better, but it did not pass publish-ready checks. We recommend ";

function freePreviewMessage(fidelity: FidelityReport): string {
  if (fidelity.text_or_pattern_drift || fidelity.invented_or_missing_details) {
    return "This version may have changed product details. Review it carefully before using it, or generate another version.";
  }
  let tail =
    "trying a cleaner, sharper source photo, or generating another version for a different result.";
  if (fidelity.ai_looking) {
    tail =
      "reviewing it closely first — this version looks AI-generated, so check it against your real product before using it.";
  } else if (!fidelity.full_product_visible) {
    tail = "uploading a photo that shows the complete product.";
  }
  return `${FREE_PREVIEW_PREFIX}${tail}`;
}

function makePhoto(p: InitialPhoto): Photo {
  const isMain = p.role === "main";
  const audit = isMain
    ? rubricToDemoState({ rubric: p.rubric, imageSrc: p.imageSrc })
    : rubricToSupportingState({ rubric: p.rubric, imageSrc: p.imageSrc });
  return {
    id: p.id,
    kind: p.role,
    imageSrc: p.imageSrc,
    audit,
    status: "graded",
    isDigital: p.rubric.upload_kind === "digital_product",
    supportingRole: p.rubric.supporting_photo_role,
    productSummary: isMain ? p.rubric.product_summary : undefined,
    improveStatus: "idle",
    freePreview: false,
    canRetry: false,
    unresolved: null,
    revertSnap: null,
  };
}

function analyzingPhoto(id: string, imageSrc: string): Photo {
  return {
    id,
    kind: "supporting",
    imageSrc,
    audit: {
      id: "weak",
      band: "mid",
      overallScore: 0,
      verdict: "",
      priorityLabel: "",
      priorityAction: "",
      pillars: [],
      nextStepsLabel: "",
      nextSteps: [],
      ctaLabel: "",
      imageSrc,
      imageAlt: "Supporting photo",
      thumbnailHeadline: "",
      thumbnailSub: "",
    },
    status: "analyzing",
    isDigital: false,
    improveStatus: "idle",
    freePreview: false,
    canRetry: false,
    unresolved: null,
    revertSnap: null,
  };
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Interactive per-product workspace: main + supporting photos, One-click fix +
 * Edit, switching, and the checklist — seeded from the DB. Supporting photos are
 * persisted (Storage + photos + audits) under RLS; generated previews stay
 * session-only per the deferred-download decision.
 */
export function ProductWorkspace({ productId, userId, initialPhotos }: Props) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>(() => initialPhotos.map(makePhoto));
  const [activeId, setActiveId] = useState<string>(
    () => initialPhotos.find((p) => p.role === "main")?.id ?? initialPhotos[0]?.id ?? ""
  );
  const [checklist, setChecklist] = useState<SupportingPhotoChecklistItem[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const photosRef = useRef<Photo[]>(photos);
  const filesRef = useRef<Record<string, File>>({});
  const extraInputRef = useRef<HTMLInputElement | null>(null);
  const mainRubric = initialPhotos.find((p) => p.role === "main")?.rubric;

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  const active = photos.find((p) => p.id === activeId) ?? null;

  function patch(id: string, next: Partial<Photo>) {
    setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, ...next } : p)));
  }

  // Hydrate the supporting-photo checklist for the main product (background).
  useEffect(() => {
    if (!mainRubric || mainRubric.upload_kind === "invalid") return;
    let alive = true;
    (async () => {
      setChecklistLoading(true);
      try {
        const res = await fetch("/api/checklist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            upload_kind: mainRubric.upload_kind,
            detected_category: mainRubric.detected_category,
            product_summary: mainRubric.product_summary,
            overall_score: mainRubric.overall_score,
            priority_action: mainRubric.priority_action,
          }),
        });
        const data = (await res.json().catch(() => null)) as
          | { supporting_photo_checklist?: SupportingPhotoChecklistItem[] }
          | null;
        if (alive) setChecklist(data?.supporting_photo_checklist ?? []);
      } catch {
        // best-effort
      } finally {
        if (alive) setChecklistLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mainRubric]);

  // Fetch a photo's original as a File for improve/edit (cached).
  const ensureFile = useCallback(
    async (id: string): Promise<File | null> => {
      if (filesRef.current[id]) return filesRef.current[id];
      const photo = photosRef.current.find((p) => p.id === id);
      if (!photo) return null;
      try {
        const res = await fetch(photo.imageSrc);
        const blob = await res.blob();
        const type = blob.type === "image/png" ? "image/png" : "image/jpeg";
        const f = new File([blob], "photo", { type });
        filesRef.current[id] = f;
        return f;
      } catch {
        return null;
      }
    },
    []
  );

  const mainContext = useCallback(() => {
    const main = photosRef.current.find((p) => p.kind === "main");
    return main?.productSummary?.trim() || undefined;
  }, []);

  const runImprove = useCallback(
    async (
      retry: boolean,
      editInstruction?: string,
      editSource: "original" | "preview" = "preview"
    ) => {
      const photo = photosRef.current.find((p) => p.id === activeId);
      if (!photo || photo.improveStatus === "generating") return;
      const f = await ensureFile(photo.id);
      if (!f) {
        patch(photo.id, { improveStatus: "error", improveError: "Could not load the photo." });
        return;
      }
      const isEdit = Boolean(editInstruction);
      const isExtra = photo.kind === "supporting";
      trackClientEvent(
        isExtra
          ? isEdit
            ? "supporting_edit_clicked"
            : "supporting_improve_clicked"
          : isEdit
          ? "edit_clicked"
          : "improve_clicked"
      );
      const startedAt = Date.now();
      const revertSnap: RevertSnap | null =
        isEdit && photo.audit.improvedSrc
          ? {
              improvedSrc: photo.audit.improvedSrc,
              improvedAudit: photo.audit.improvedAudit,
              improvedScore: photo.audit.improvedScore,
              improvedVerdict: photo.audit.improvedVerdict,
              improvedDownloadUrl: photo.improvedDownloadUrl,
              freePreview: photo.freePreview,
              freePreviewMessage: photo.freePreviewMsg,
            }
          : photo.revertSnap;
      patch(photo.id, {
        improveStatus: "generating",
        improveStartedAt: startedAt,
        improveError: undefined,
        canRetry: false,
        revertSnap,
      });

      try {
        const form = new FormData();
        form.set("image", f);
        if (isExtra) {
          form.set("mode", "extra");
          const ctx = mainContext();
          if (ctx) form.set("main_product_context", ctx);
        }
        const useBase =
          (retry || (isEdit && editSource === "preview")) && photo.improvedDownloadUrl;
        if (useBase) {
          form.set("retryBaseImage", await compressDataUrlForUpload(photo.improvedDownloadUrl!));
        }
        if (isEdit) form.set("editInstruction", editInstruction!);
        if (retry && !isEdit && photo.unresolved?.length) {
          form.set("unresolvedIssues", JSON.stringify(photo.unresolved));
        }
        const res = await fetch("/api/generate", { method: "POST", body: form });
        const body = (await res.json().catch(() => null)) as
          | GenerateSuccessBody
          | GenerateFailureBody
          | null;

        const cur = photosRef.current.find((p) => p.id === photo.id);
        const hasPreview = Boolean(cur?.audit.improvedSrc);

        if (!res.ok || !body || body.ok === false) {
          const message =
            body && body.ok === false ? body.message : `Generation failed (${res.status})`;
          const retryable = new Set([
            "no_publishable_candidate",
            "incomplete_source",
            "unsafe_candidate",
            "image_failed",
          ]);
          patch(photo.id, {
            improveStatus: hasPreview ? "idle" : "error",
            improveStartedAt: undefined,
            improveError: hasPreview ? undefined : message,
            unresolved:
              body && body.ok === false && Array.isArray(body.unresolvedIssues)
                ? body.unresolvedIssues
                : cur?.unresolved ?? null,
            canRetry: hasPreview
              ? typeof cur?.audit.improvedScore === "number" && cur.audit.improvedScore < 8
              : retryable.has(body && body.ok === false ? body.code : ""),
          });
          return;
        }

        const improvedDataUrl = `data:${body.previewMimeType};base64,${body.previewBase64}`;
        const improvedAudit = isExtra
          ? rubricToSupportingAuditResult(body.candidateAudit)
          : rubricToAuditResult(body.candidateAudit);
        const isFree = body.outcome === "useful_free_preview";
        patch(photo.id, {
          improvedDownloadUrl: improvedDataUrl,
          freePreview: isFree,
          freePreviewMsg: isFree ? freePreviewMessage(body.fidelity) : undefined,
          improveStatus: "idle",
          improveStartedAt: undefined,
          improveError: undefined,
          canRetry: improvedAudit.overallScore < 8,
          unresolved: null,
          audit: {
            ...(cur?.audit ?? photo.audit),
            improvedSrc: improvedDataUrl,
            improvedAudit,
            improvedScore: improvedAudit.overallScore,
            improvedVerdict: improvedAudit.verdict,
            comparisonMode: "toggle",
          },
        });
        trackClientEvent(
          isExtra
            ? isEdit
              ? "supporting_edit_completed"
              : "supporting_improve_completed"
            : isEdit
            ? "edit_completed"
            : "improve_completed"
        );
      } catch (err) {
        const cur = photosRef.current.find((p) => p.id === photo.id);
        const hasPreview = Boolean(cur?.audit.improvedSrc);
        patch(photo.id, {
          improveStatus: hasPreview ? "idle" : "error",
          improveStartedAt: undefined,
          improveError: hasPreview
            ? undefined
            : err instanceof Error
            ? err.message
            : "Generation failed.",
          canRetry: true,
        });
      }
    },
    [activeId, ensureFile, mainContext]
  );

  const handleImprove = useCallback(() => runImprove(false), [runImprove]);
  const handleRetry = useCallback(() => runImprove(true), [runImprove]);
  const handleEdit = useCallback(
    (instruction: string, source: "original" | "preview") =>
      runImprove(false, instruction, source),
    [runImprove]
  );
  const handleRevert = useCallback(() => {
    const photo = photosRef.current.find((p) => p.id === activeId);
    if (!photo?.revertSnap) return;
    const snap = photo.revertSnap;
    patch(photo.id, {
      improvedDownloadUrl: snap.improvedDownloadUrl,
      freePreview: Boolean(snap.freePreview),
      freePreviewMsg: snap.freePreviewMessage,
      canRetry:
        typeof snap.improvedScore === "number" ? snap.improvedScore < 8 : photo.canRetry,
      revertSnap: null,
      audit: {
        ...photo.audit,
        improvedSrc: snap.improvedSrc,
        improvedAudit: snap.improvedAudit,
        improvedScore: snap.improvedScore,
        improvedVerdict: snap.improvedVerdict,
      },
    });
  }, [activeId]);

  const handleSelectSlot = useCallback((id: string) => {
    setActiveId(id);
    setNotice(null);
  }, []);

  const handleAddPhoto = useCallback(() => extraInputRef.current?.click(), []);

  // Upload a supporting photo: score (mode=extra) then persist under RLS.
  const addSupporting = useCallback(
    async (inputFile: File) => {
      if (!inputFile.type.startsWith("image/")) {
        setNotice("That file is not an image.");
        return;
      }
      const prepared = await prepareUploadImage(inputFile);
      const blobUrl = URL.createObjectURL(prepared);
      const tempId = makeId();
      filesRef.current[tempId] = prepared;
      setPhotos((prev) => [...prev, analyzingPhoto(tempId, blobUrl)]);
      setActiveId(tempId);
      setNotice(null);
      trackClientEvent("supporting_photo_uploaded");

      try {
        const form = new FormData();
        form.set("image", prepared);
        form.set("mode", "extra");
        const ctx = mainContext();
        if (ctx) form.set("main_product_context", ctx);
        const res = await fetch("/api/score", { method: "POST", body: form });
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(b?.error || `Score failed (${res.status})`);
        }
        const { rubric } = (await res.json()) as { rubric: RubricJson };
        if (rubric.upload_kind === "invalid") {
          setPhotos((prev) => prev.filter((p) => p.id !== tempId));
          setActiveId(photosRef.current.find((p) => p.kind === "main")?.id ?? "");
          setNotice("That image is not a product photo.");
          return;
        }
        const audit = rubricToSupportingState({ rubric, imageSrc: blobUrl });
        patch(tempId, {
          status: "graded",
          audit,
          supportingRole: rubric.supporting_photo_role,
        });
        trackClientEvent("supporting_audit_completed");

        // Persist (best-effort; keep the session slot even if saving fails).
        try {
          const supabase = createSupabaseBrowserClient();
          const ext = prepared.type === "image/png" ? "png" : "jpg";
          const path = `${userId}/${productId}/${tempId}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("product-photos")
            .upload(path, prepared, { contentType: prepared.type });
          if (upErr) throw upErr;
          const { error: phErr } = await supabase.from("photos").insert({
            id: tempId,
            product_id: productId,
            role: "supporting",
            storage_path: path,
            mime: prepared.type,
          });
          if (phErr) throw phErr;
          await supabase.from("audits").insert({
            photo_id: tempId,
            kind: "supporting",
            rubric,
            overall_score: rubric.overall_score,
          });
        } catch {
          setNotice("Scored, but could not save this supporting photo. It stays for this session.");
        }
      } catch (err) {
        setPhotos((prev) => prev.filter((p) => p.id !== tempId));
        setActiveId(photosRef.current.find((p) => p.kind === "main")?.id ?? "");
        setNotice(err instanceof Error ? err.message : "That photo could not be graded.");
      }
    },
    [mainContext, productId, userId]
  );

  if (!active) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-[1200px] px-6 py-10 text-[15px] text-[var(--color-ink-muted)]">
          This product has no photo yet.
        </main>
      </>
    );
  }

  const wrongProduct = active.supportingRole === "unrelated_or_wrong_product";
  const slotViews: SlotView[] = photos.map((p) => ({
    id: p.id,
    label: p.kind === "main" ? "Main photo" : "Supporting",
    thumbnailUrl: p.imageSrc,
    status: p.improveStatus === "generating" ? "improving" : p.status,
    score: p.status === "graded" ? p.audit.overallScore : undefined,
    active: p.id === activeId,
  }));

  return (
    <>
      <AppHeader />
      <input
        ref={extraInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addSupporting(f);
          e.target.value = "";
        }}
      />
      <AuditWorkspace
        key={active.id}
        state={
          active.kind === "main"
            ? { ...active.audit, supportingChecklist: checklist }
            : active.audit
        }
        uploadedSrc={active.imageSrc}
        panelMode={active.kind === "main" ? "main" : "extra"}
        analyzing={active.status === "analyzing"}
        slots={slotViews}
        onSelectSlot={handleSelectSlot}
        onAddPhoto={handleAddPhoto}
        notice={notice ?? undefined}
        onCta={() => router.push("/dashboard")}
        onImprove={wrongProduct ? undefined : handleImprove}
        onRetryImprove={!wrongProduct && active.canRetry ? handleRetry : undefined}
        onEdit={
          (active.kind === "main" && active.isDigital) || wrongProduct
            ? undefined
            : handleEdit
        }
        onRevert={active.revertSnap ? handleRevert : undefined}
        improveLoading={active.improveStatus === "generating"}
        improveStartedAt={active.improveStartedAt}
        improveError={active.improveError}
        improvedDownloadUrl={active.improvedDownloadUrl}
        freePreview={active.freePreview}
        freePreviewMessage={active.freePreviewMsg}
        checklistLoading={active.kind === "main" ? checklistLoading : false}
        animate
      />
    </>
  );
}
