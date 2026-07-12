"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Info,
  Loader2,
  Sparkles,
  WandSparkles,
  Wrench,
} from "lucide-react";
import type { DemoState } from "@/data/demo-states";
import {
  bandColors,
  bandForScore,
  cn,
  prefersReducedMotion,
  type ScoreBand,
} from "@/lib/utils";
import { MediaProofPanel } from "./media-proof-panel";
import { MarketplaceThumbnailPreview } from "./marketplace-thumbnail-preview";
import { PhotoSlotStrip, type SlotView } from "./photo-slot-strip";
import { ComparisonPreview } from "./comparison-preview";
import { ScoreVerdict } from "./score-verdict";
import { PillarScores } from "./pillar-scores";
import { NextSteps } from "./next-steps";
import { EditPhotoModal } from "./edit-photo-modal";
import { PhotoChecklistPanel } from "./photo-checklist-panel";
import { SUPPORTING_ROLE_LABELS } from "@/lib/audit-mapping";

const IMPROVE_STATUSES = [
  "Analyzing fixes…",
  "Generating cleaner photo…",
  "Checking product details…",
  "Scoring the result…",
];

const IMPROVE_ESTIMATE_SECONDS = 56;

const BACKGROUND_REFINING_STATUSES = [
  "This photo is better than your previous photo, but we think we can do better.",
  "We are improving it in the background. You do not need to do anything.",
  "We are checking another version to deliver the best photo possible.",
];

const SUPPORTING_ANALYZING_STATUSES = [
  "Reading this listing photo…",
  "Checking detail and trust…",
  "Preparing the supporting photo grade…",
];

type Props = {
  state: DemoState;
  uploadedSrc?: string;
  onCta: () => void;
  /**
   * Async improve flow. When provided, the improve CTA awaits this before
   * unlocking the preview. The parent is expected to mutate `state` to add
   * `improvedSrc` + `improvedAudit` before the promise resolves.
   */
  onImprove?: () => Promise<void> | void;
  improveLoading?: boolean;
  /** Attempts 2-3 are running while the current safe preview remains usable. */
  backgroundRefining?: boolean;
  /** Epoch ms when the active slot started improving. Preserves countdown across slot switches. */
  improveStartedAt?: number;
  improveError?: string;
  /** Truthful pipeline-stage label from the generation job (replaces rotating copy). */
  improveStage?: string;
  /** True when the active preview is safe to show but needs seller review. */
  freePreview?: boolean;
  /** Specific upload recommendation shown for a free preview. */
  freePreviewMessage?: string;
  /** Muted status shown when a retry keeps the existing better preview. */
  keepNote?: string;
  /** Checklist shot ids already covered by uploaded supporting photos. */
  coveredShotIds?: string[];
  /** Plain-language edit. When provided, an "Edit photo" button opens the edit modal. Physical products only. */
  onEdit?: (
    instruction: string,
    source: "original" | "preview"
  ) => Promise<void> | void;
  /** One-step revert to the pre-edit version. Shown only when a snapshot exists. */
  onRevert?: () => void;
  /** True while the supporting-photo checklist is still hydrating in the background. */
  checklistLoading?: boolean;
  /** "main" = hero/thumbnail panel (Etsy preview + improve). "extra" = supporting photo grade. */
  panelMode?: "main" | "extra";
  /** Photo slots for the workspace strip. Omitted on demo routes -> strip hidden. */
  slots?: SlotView[];
  onSelectSlot?: (id: string) => void;
  onAddPhoto?: () => void;
  /** Transient workspace notice (e.g. a rejected extra upload). */
  notice?: string;
  /** Active slot is still being graded — right panel shows an inline loader. */
  analyzing?: boolean;
  animate?: boolean;
  initialPreview?: boolean;
};

export function AuditWorkspace({
  state,
  uploadedSrc,
  onCta,
  onImprove,
  improveLoading = false,
  backgroundRefining = false,
  improveStartedAt,
  improveError,
  improveStage,
  freePreview = false,
  freePreviewMessage,
  keepNote,
  coveredShotIds,
  onEdit,
  onRevert,
  checklistLoading = false,
  panelMode = "main",
  slots,
  onSelectSlot,
  onAddPhoto,
  notice,
  analyzing = false,
  animate = true,
  initialPreview = false,
}: Props) {
  const isExtra = panelMode === "extra";
  const [revealed, setRevealed] = useState(!animate);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [improveElapsed, setImproveElapsed] = useState(0);
  const [improveStatusIdx, setImproveStatusIdx] = useState(0);
  const [backgroundStatusIdx, setBackgroundStatusIdx] = useState(0);
  const [analyzingIdx, setAnalyzingIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<"original" | "preview">(
    initialPreview ? "preview" : "original"
  );
  const [previewUnlocked, setPreviewUnlocked] = useState(initialPreview);
  const [hasImprovement, setHasImprovement] = useState(false);

  useEffect(() => {
    if (!animate) return;
    const delay = prefersReducedMotion() ? 16 : 40;
    const id = window.setTimeout(() => setRevealed(true), delay);
    return () => window.clearTimeout(id);
  }, [animate]);

  const isWeak = state.band === "weak";
  const isMid = state.band === "mid";
  const isStrong = state.band === "strong";
  // Weak/mid photos can be improved — main by the hero rubric, extra by the
  // supporting rubric. Strong photos are already affirmed; no improve.
  const canShowImprovement = isWeak || isMid;
  const improvedSrc = state.improvedSrc;
  const generatedPreviewExists = Boolean(improvedSrc && hasImprovement);
  const previewActive =
    canShowImprovement &&
    hasImprovement &&
    previewUnlocked &&
    activeTab === "preview";
  const editSource =
    activeTab === "preview" && hasImprovement && improvedSrc
      ? "preview"
      : "original";
  const editImageSrc =
    editSource === "preview" && improvedSrc
      ? improvedSrc
      : uploadedSrc ?? state.imageSrc;
  const activeAudit =
    previewActive && state.improvedAudit ? state.improvedAudit : state;

  const scoreDeltaLabel =
    previewActive
      ? `${state.overallScore.toFixed(1)} -> ${activeAudit.overallScore.toFixed(1)}`
      : "";
  const previewBelowPublishReady = previewActive && activeAudit.overallScore < 8;

  useEffect(() => {
    if (!canShowImprovement || !improvedSrc) return;
    let cancelled = false;
    const probe = new window.Image();
    probe.onload = () => !cancelled && setHasImprovement(true);
    probe.onerror = () => {
      if (!cancelled) {
        setHasImprovement(false);
        setActiveTab("original");
      }
    };
    probe.src = improvedSrc;
    return () => {
      cancelled = true;
    };
  }, [canShowImprovement, improvedSrc]);

  // Inline improve countdown + rotating status. Keeps the audit page visible.
  useEffect(() => {
    if (!improveLoading) return;
    const start = improveStartedAt ?? Date.now();
    const reset = window.setTimeout(() => {
      setImproveElapsed(Math.floor((Date.now() - start) / 1000));
      setImproveStatusIdx(0);
    }, 0);
    const tick = window.setInterval(
      () => setImproveElapsed(Math.floor((Date.now() - start) / 1000)),
      1000
    );
    const rotate = window.setInterval(
      () => setImproveStatusIdx((i) => (i + 1) % IMPROVE_STATUSES.length),
      2000
    );
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(tick);
      window.clearInterval(rotate);
    };
  }, [improveLoading, improveStartedAt]);

  const improveRemaining = IMPROVE_ESTIMATE_SECONDS - improveElapsed;
  const improveCountdown =
    improveRemaining > 0 ? `Generating… ${improveRemaining}s` : "Finishing…";
  // Prefer the truthful job-stage label when the caller provides one; the
  // rotating copy is only the fallback for flows without job state.
  const improveStatus = improveStage ?? IMPROVE_STATUSES[improveStatusIdx];

  useEffect(() => {
    if (!backgroundRefining) return;
    const reset = window.setTimeout(() => setBackgroundStatusIdx(0), 0);
    const rotate = window.setInterval(
      () =>
        setBackgroundStatusIdx(
          (i) => (i + 1) % BACKGROUND_REFINING_STATUSES.length
        ),
      2000
    );
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(rotate);
    };
  }, [backgroundRefining]);

  const backgroundStatus = BACKGROUND_REFINING_STATUSES[backgroundStatusIdx];

  // Inline supporting-photo analyzing status rotation (right panel only).
  useEffect(() => {
    if (!analyzing) return;
    const reset = window.setTimeout(() => setAnalyzingIdx(0), 0);
    const id = window.setInterval(
      () =>
        setAnalyzingIdx((i) => (i + 1) % SUPPORTING_ANALYZING_STATUSES.length),
      1800
    );
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(id);
    };
  }, [analyzing]);
  const analyzingStatus = SUPPORTING_ANALYZING_STATUSES[analyzingIdx];

  return (
    <main className="px-6 py-5 pb-10">
      {notice && (
        <div
          role="status"
          className="mx-auto mb-4 flex max-w-[1200px] items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-mid)] bg-[var(--color-mid-soft)] px-3 py-2 text-[13px] text-[var(--color-ink)]"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-mid)]"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span>{notice}</span>
        </div>
      )}
      <div
        className={cn(
          "mx-auto grid max-w-[1200px] grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-6 lg:gap-8 items-start",
          revealed && "reveal-on"
        )}
      >
        {/* LEFT: MEDIA */}
        <section
          aria-label="Submitted photo and previews"
          className="flex flex-col gap-3"
        >
          <div className="relative">
            <MediaProofPanel
              src={state.imageSrc}
              overrideSrc={
                editSource === "preview" && improvedSrc ? improvedSrc : uploadedSrc
              }
              alt={state.imageAlt}
              placeholderLabel={state.imageSrc.split("/").pop()}
              placeholderSub={
                isStrong
                  ? "model-worn initial earring (strong demo)"
                  : isWeak
                  ? "teacup candle (weak demo)"
                  : undefined
              }
              contain
            />
            {onEdit && !improveLoading && !backgroundRefining && editImageSrc && (
              <button
                type="button"
                onClick={() => setEditModalOpen(true)}
                className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-[rgba(25,23,20,0.78)] px-4 py-2 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(25,23,20,0.20)] backdrop-blur-sm transition-all hover:bg-[rgba(25,23,20,0.9)]"
              >
                <Wrench className="h-4 w-4" aria-hidden="true" />
                Edit
              </button>
            )}
          </div>

          {canShowImprovement && hasImprovement && improvedSrc && previewUnlocked && (
            <ComparisonPreview
              improvedSrc={improvedSrc}
              mode={state.comparisonMode}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          )}

          {/* Etsy search preview is a main-photo concept only. */}
          {!isExtra && (
            <MarketplaceThumbnailPreview
              src={state.imageSrc}
              overrideSrc={
                previewActive && improvedSrc ? improvedSrc : uploadedSrc
              }
              alt=""
              headline={
                previewActive
                  ? activeAudit.thumbnailHeadline
                  : state.thumbnailHeadline
              }
              sub={
                previewActive
                  ? activeAudit.thumbnailSub
                  : state.thumbnailSub
              }
              contain={previewActive}
            />
          )}

          {/* Square photo strip sits directly below the Etsy preview: upload
              supporting photos, switch the whole workspace between them. */}
          {slots && onSelectSlot && onAddPhoto && (
            <PhotoSlotStrip
              slots={slots}
              onSelect={onSelectSlot}
              onAdd={onAddPhoto}
            />
          )}

          {!isExtra &&
            (checklistLoading ||
              (state.supportingChecklist &&
                state.supportingChecklist.length > 0)) && (
              <PhotoChecklistPanel
                checklist={state.supportingChecklist ?? []}
                loading={checklistLoading}
                coveredShotIds={coveredShotIds}
              />
            )}
        </section>

        {/* RIGHT: AUDIT */}
        <section
          aria-label="Audit result"
          className="flex flex-col gap-3.5"
        >
          {analyzing ? (
            <div className="reveal-item" data-reveal-order="0">
              <span className="eyebrow mb-2 block">
                {isExtra ? "Supporting photo grade" : "Photo grade"}
              </span>
              <div
                className="text-[18px] font-medium leading-snug text-[var(--color-ink)]"
                aria-live="polite"
              >
                {analyzingStatus}
              </div>
              <div className="progress-track mt-4" aria-hidden="true">
                <span className="progress-indeterminate" />
              </div>
            </div>
          ) : (
            <>
          <div className="reveal-item relative" data-reveal-order="0">
            <ScoreVerdict
              key={previewActive ? "improved" : "original"}
              score={activeAudit.overallScore}
              verdict={activeAudit.verdict}
              heading={isExtra ? "Supporting photo grade" : "Main photo score"}
              animate={animate}
            />
            <ScoringInfo isExtra={isExtra} />
            {isExtra && state.supportingRole && state.supportingRole !== "other" && (
              <div className="mt-3 flex flex-col gap-1.5">
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--color-tint)] px-3 py-1 text-[12px] font-semibold text-[var(--color-primary)]">
                  {SUPPORTING_ROLE_LABELS[state.supportingRole] ?? "Supporting photo"} - detected
                </span>
                {state.buyerQuestion && (
                  <span className="text-[13px] text-[var(--color-ink-muted)]">
                    Answers:{" "}
                    <span className="font-semibold text-[var(--color-ink)]">
                      &ldquo;{state.buyerQuestion}&rdquo;
                    </span>
                  </span>
                )}
                {state.supportingVerdictText && (
                  <span className="text-[13px] text-[var(--color-ink)]">
                    {state.supportingVerdictText}
                  </span>
                )}
              </div>
            )}
            {previewActive && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-ink-muted)]">
                  <span className="text-[var(--color-weak)]">
                    {state.overallScore.toFixed(1)}
                  </span>
                  <ArrowRight className="h-3 w-3 text-[var(--color-ink-soft)]" aria-hidden="true" />
                  <span className="text-[var(--color-strong)]">
                    {activeAudit.overallScore.toFixed(1)}
                  </span>
                </span>
                <span className="text-[var(--color-ink-soft)]">
                  AI-improved preview, saved to this product. Label text and small patterns may differ. Do not publish unless they match your physical product.
                </span>
              </div>
            )}
          </div>

          <div className="reveal-item" data-reveal-order="1">
            <PriorityBlock
              label={activeAudit.priorityLabel}
              action={activeAudit.priorityAction}
              observation={activeAudit.priorityObservation}
              score={activeAudit.overallScore}
              band={bandForScore(activeAudit.overallScore)}
            />
          </div>

          <div className="reveal-item" data-reveal-order="2">
            <PillarScores pillars={activeAudit.pillars} />
          </div>

          <div className="reveal-item" data-reveal-order="3">
            <NextSteps
              label={activeAudit.nextStepsLabel}
              steps={activeAudit.nextSteps}
              band={bandForScore(activeAudit.overallScore)}
            />
          </div>


          {/* Improve flow: main uses the hero rubric, extra the supporting rubric. */}
          {(
          <div className="reveal-item mt-1.5 border-t border-[var(--color-border-soft)] pt-4" data-reveal-order="4">
            {/* A failed retry must not show an alarming banner over an already
                delivered preview — the displayed result WAS delivered.
                The "Generate another version" control stays available below. */}
            {improveError && !(previewActive && !freePreview) && (
              <div className="mb-3 flex flex-col items-start gap-2.5">
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-3 py-2 text-[13px] text-[var(--color-ink)]"
                >
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-weak)]"
                    strokeWidth={2}
                    aria-hidden="true"
                  />
                  <span>{improveError}</span>
                </div>
                {improveLoading && (
                  <span
                    className="ml-9 text-[12.5px] text-[var(--color-ink-soft)]"
                    aria-live="polite"
                  >
                    {improveStatus}
                  </span>
                )}
              </div>
            )}
            {improveLoading && !previewActive ? (
              // Generating with no preview yet (fresh improve OR an edit from the
              // original). Show the SAME prominent countdown as the AI-improve
              // button, not just the small spinner on the image.
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton onClick={() => undefined} variant="primary" disabled>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {improveCountdown}
                </PrimaryButton>
                <span
                  className="text-[12.5px] text-[var(--color-ink-soft)]"
                  aria-live="polite"
                >
                  {improveStatus}
                </span>
              </div>
            ) : previewActive ? (
              <div className="flex flex-col items-start gap-3">
                {scoreDeltaLabel && (
                  <div className="rounded-full bg-[var(--color-strong-soft)] px-3 py-1 text-[13px] font-bold text-[var(--color-strong)]">
                    {scoreDeltaLabel}
                  </div>
                )}
                {freePreview && freePreviewMessage && (
                  <div className="max-w-[620px] rounded-[var(--radius-lg)] border border-[var(--color-mid)] bg-[var(--color-mid-soft)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink)]">
                    {freePreviewMessage}
                  </div>
                )}
                {backgroundRefining && previewBelowPublishReady ? (
                  <div
                    className="max-w-[620px] rounded-[var(--radius-lg)] border border-[var(--color-mid)] bg-[var(--color-mid-soft)] px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink)]"
                    role="status"
                    aria-live="polite"
                  >
                    {backgroundStatus}
                  </div>
                ) : keepNote && previewBelowPublishReady ? (
                  <div className="max-w-[620px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                    {keepNote}
                  </div>
                ) : null}
                {(onEdit || onRevert) && !improveLoading && (
                  <div className="flex flex-wrap items-center gap-3">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={() => setEditModalOpen(true)}
                        disabled={backgroundRefining}
                        aria-label={
                          backgroundRefining
                            ? "Edit photo after background improvement finishes"
                            : "Edit photo"
                        }
                        className={cn(
                          "inline-flex items-center gap-2 rounded-full border bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-all hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]",
                          backgroundRefining
                            ? "background-refining-button cursor-wait border-transparent"
                            : "border-[var(--color-border)]"
                        )}
                      >
                        <Wrench className="h-4 w-4" aria-hidden="true" />
                        Edit photo
                      </button>
                    )}
                    {onRevert && (
                      <button
                        type="button"
                        onClick={onRevert}
                        className="text-[13px] font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline"
                      >
                        Revert last edit
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <>
                {isStrong && (
                  <PrimaryButton onClick={onCta} variant="primary">
                    {state.ctaLabel}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </PrimaryButton>
                )}
                {canShowImprovement &&
                  activeTab === "original" &&
                  (hasImprovement || onImprove) && (
                    <div className="flex flex-wrap items-center gap-3">
                      {!generatedPreviewExists && <PrimaryButton
                        onClick={async () => {
                          if (generatedPreviewExists) {
                            return;
                          }
                          if (onImprove) {
                            await onImprove();
                            setPreviewUnlocked(true);
                            setActiveTab("preview");
                          } else if (hasImprovement) {
                            setPreviewUnlocked(true);
                            setActiveTab("preview");
                            onCta();
                          }
                        }}
                        variant="primary"
                        disabled={improveLoading}
                      >
                        {improveLoading ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <WandSparkles
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        )}
                        {improveLoading
                          ? improveCountdown
                          : "One-click fix"}
                      </PrimaryButton>
                      }
                      {onEdit && !improveLoading && (
                        <button
                          type="button"
                          onClick={() => setEditModalOpen(true)}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-all hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
                        >
                          <Wrench className="h-4 w-4" aria-hidden="true" />
                          Edit photo
                        </button>
                      )}
                      {onRevert && !improveLoading && (
                        <button
                          type="button"
                          onClick={onRevert}
                          className="text-[13px] font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline"
                        >
                          Revert last edit
                        </button>
                      )}
                      {improveLoading && (
                        <span
                          className="text-[12.5px] text-[var(--color-ink-soft)]"
                          aria-live="polite"
                        >
                          {improveStatus}
                        </span>
                      )}
                    </div>
                  )}
              </>
            )}
          </div>
          )}
            </>
          )}
        </section>
      </div>

      {editModalOpen && onEdit && editImageSrc && (
        <EditPhotoModal
          imageSrc={editImageSrc}
          loading={improveLoading}
          mode={isExtra ? "extra" : "main"}
          onClose={() => setEditModalOpen(false)}
          onSubmit={(instruction) => {
            setEditModalOpen(false);
            setPreviewUnlocked(true);
            setActiveTab("preview");
            void onEdit(instruction, editSource);
          }}
        />
      )}
    </main>
  );
}

/**
 * Compact "How scoring works" explainer. Honest framing: Etsy-oriented rubric,
 * fixed pillar weights, guidance not a sales guarantee, generation separately
 * fidelity-checked. No claims of statistical validation.
 */
function ScoringInfo({ isExtra }: { isExtra: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute right-0 top-0">
      <button
        type="button"
        aria-label="How scoring works"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)]"
      >
        <Info className="h-4 w-4" aria-hidden="true" />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-9 z-20 w-[300px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-4 text-left shadow-[var(--shadow-soft-strong)]">
            <p className="text-[13px] font-bold text-[var(--color-ink)]">
              How scoring works
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
              {isExtra
                ? "Supporting photos are judged on the job they do for a buyer: Buyer Confidence (35%), Clarity (30%), Accuracy (20%), and Presentation (15%)."
                : "The score is built for Etsy listings: Thumbnail readability (40%), Lighting (25%), Background (20%), and Click Appeal (15%)."}
            </p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-[var(--color-ink-muted)]">
              8.0+ is strong, 6.0-7.9 is workable, below 6.0 needs attention.
              AI-improved photos are separately checked for product fidelity before
              they are shown.
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-ink-soft)]">
              A high score is guidance for getting clicks, not a guarantee of sales.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function PriorityBlock({
  label,
  action,
  observation,
  score,
  band,
}: {
  label: string;
  action: string;
  observation?: string;
  score: number;
  band: ScoreBand;
}) {
  const Icon = band === "strong" ? Sparkles : Wrench;
  // Priority block color follows the SCORE BAND, not just weak/strong split
  const scoreBand = bandForScore(score);
  const colors = bandColors(scoreBand);

  return (
    <div
      className="relative rounded-[var(--radius-xl)] px-6 py-5"
      style={{ background: colors.soft }}
    >
      <div className="flex items-start gap-4">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white shadow-[0_1px_2px_rgba(25,23,20,0.06)]"
          style={{ color: colors.accent }}
        >
          <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
        </div>
        <div className="flex-1">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: colors.accent }}
          >
            {label}
          </div>
          <div className="mt-1.5 text-[18px] font-bold leading-[1.3] tracking-[-0.005em] text-[var(--color-ink)]">
            {action}
          </div>
          {observation && (
            <div className="mt-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
              {observation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PrimaryButton({
  onClick,
  variant,
  children,
  disabled = false,
}: {
  onClick: () => void | Promise<void>;
  variant: "primary" | "neutral";
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-semibold text-white transition-all active:translate-y-[1px]",
        variant === "primary"
          ? "bg-[var(--color-primary)] shadow-[0_4px_12px_rgba(232,107,57,0.30)] hover:bg-[var(--color-primary-hover)] hover:shadow-[0_6px_16px_rgba(216,91,44,0.36)]"
          : "bg-[var(--color-neutral-dark)] shadow-[0_4px_12px_rgba(63,58,53,0.25)] hover:bg-[var(--color-neutral-dark-hover)]",
        disabled && "cursor-not-allowed opacity-70"
      )}
    >
      {children}
    </button>
  );
}
