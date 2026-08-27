"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  Download,
  Info,
  Loader2,
  MoreVertical,
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
import { BuyerQuestionCoveragePanel } from "./buyer-question-coverage-panel";
import type { CoverageState } from "@/lib/buyer-question-coverage";
import { SUPPORTING_ROLE_LABELS } from "@/lib/audit-mapping";
import { buildEditSuggestionChips, deriveEditContext } from "@/lib/selection-display";

const EMPTY_CHECKED_QUESTION_IDS: ReadonlySet<string> = new Set();
const NOOP = () => undefined;

const IMPROVE_STATUSES = [
  "Analyzing fixes…",
  "Generating cleaner photo…",
  "Checking product details…",
  "Scoring the result…",
];

const IMPROVE_ESTIMATE_SECONDS = 56;

const SUPPORTING_ANALYZING_STATUSES = [
  "Reading this listing photo…",
  "Checking detail and trust…",
  "Preparing the supporting photo grade…",
];

/**
 * Bold every "AI Edit" substring in a plain-text message (the button's name),
 * so the copy can point at it without threading ReactNode through props.
 */
function boldAIEdit(text: string): React.ReactNode {
  return text.split(/(AI Edit)/g).map((part, i) =>
    part === "AI Edit" ? <strong key={i}>{part}</strong> : part
  );
}

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
  /** True when the running generation is a seller-directed EDIT: the loading
   *  state renders as the white Edit-style button, never the orange CTA. */
  editLoading?: boolean;
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
  /** Plain-language edit. When provided, an "AI Edit" button opens the edit modal. Physical products only. */
  onEdit?: (
    instruction: string,
    source: "original" | "preview"
  ) => Promise<void> | void;
  /** Version picker entries (Original + last 5 versions, newest first). */
  versionOptions?: Array<{
    jobId: string | null;
    label: string;
    sub?: string;
    current: boolean;
  }>;
  onSelectVersion?: (jobId: string | null) => void;
  versionBusy?: boolean;
  /** True while the supporting-photo checklist is still hydrating in the background. */
  checklistLoading?: boolean;
  /** First generation failed and nothing is saved: keep the panel with a retry. */
  checklistError?: boolean;
  onChecklistRetry?: () => void;
  /** Supporting photos only: deleting is always the seller's decision. */
  onRemovePhoto?: () => void;
  /** "main" = hero/thumbnail panel (Etsy preview + improve). "extra" = supporting photo grade. */
  panelMode?: "main" | "extra";
  /** Photo slots for the workspace strip. Omitted on demo routes -> strip hidden. */
  slots?: SlotView[];
  onSelectSlot?: (id: string) => void;
  onAddPhoto?: () => void;
  /** Transient workspace notice (e.g. a rejected extra upload). */
  notice?: string;
  /** Persistent context line above the pillar bars: graphic vs digital-item
   *  disclosure so the seller knows what lens the score was applied with. */
  contextBanner?: string;
  /** Active slot is still being graded — right panel shows an inline loader. */
  analyzing?: boolean;
  animate?: boolean;
  initialPreview?: boolean;
  /** Server-computed buyer-question coverage (slice 3, 2026-08-23). Omitted
   *  entirely on the landing-page demo, which has no real coverage data --
   *  the panel below falls back to the legacy checklist exactly as before
   *  when this is undefined, so the demo is unaffected. */
  coverageState?: CoverageState;
  /** Seller-controlled, session-only buyer-question checklist state. Kept
   *  above this photo-keyed workspace so switching photos cannot erase it. */
  checkedBuyerQuestionIds?: ReadonlySet<string>;
  onToggleBuyerQuestion?: (questionId: string) => void;
  /** Bump this (e.g. a counter incremented by the parent) to imperatively
   *  open the edit modal from outside -- the style picker's "AI Edit"
   *  option lives in ProductWorkspace, not here, but editModalOpen is this
   *  component's own state. Ignored on mount and whenever the value repeats
   *  (only a genuine change opens the modal), so passing 0 or leaving this
   *  undefined never opens anything by itself. */
  requestEditOpen?: number;
};

export function AuditWorkspace({
  state,
  uploadedSrc,
  onCta,
  onImprove,
  improveLoading = false,
  editLoading = false,
  backgroundRefining = false,
  improveStartedAt,
  improveError,
  improveStage,
  freePreview = false,
  freePreviewMessage,
  keepNote,
  coveredShotIds,
  onEdit,
  versionOptions,
  onSelectVersion,
  versionBusy = false,
  checklistLoading = false,
  checklistError = false,
  onChecklistRetry,
  onRemovePhoto,
  panelMode = "main",
  slots,
  onSelectSlot,
  onAddPhoto,
  notice,
  contextBanner,
  analyzing = false,
  animate = true,
  initialPreview = false,
  coverageState,
  checkedBuyerQuestionIds,
  onToggleBuyerQuestion,
  requestEditOpen,
}: Props) {
  const isExtra = panelMode === "extra";
  const [revealed, setRevealed] = useState(!animate);
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Adjusted DURING render (React's documented pattern for this), not in a
  // useEffect: an effect only runs after the browser has already painted
  // the picker-closed/modal-still-closed frame, which is exactly the
  // one-frame flash a seller reported seeing between "AI Edit" closing the
  // picker and the edit modal appearing. Comparing against state (not a
  // ref) and calling setState here makes React discard this render and
  // redo it before anything commits to the DOM, so the modal opens in the
  // SAME paint the picker disappears in -- no visible gap. Initializing
  // handledRequestEditOpen to requestEditOpen's own starting value is what
  // skips the initial mount (they're equal, so nothing opens on first render).
  const [handledRequestEditOpen, setHandledRequestEditOpen] = useState(requestEditOpen);
  if (requestEditOpen !== handledRequestEditOpen) {
    setHandledRequestEditOpen(requestEditOpen);
    if (requestEditOpen !== undefined) {
      setEditModalOpen(true);
    }
  }
  const [versionMenuOpen, setVersionMenuOpen] = useState(false);
  const [improveElapsed, setImproveElapsed] = useState(0);
  const [improveStatusIdx, setImproveStatusIdx] = useState(0);
  const [backgroundElapsed, setBackgroundElapsed] = useState(0);
  const [analyzingIdx, setAnalyzingIdx] = useState(0);
  const [activeTab, setActiveTab] = useState<"original" | "preview">(
    initialPreview ? "preview" : "original"
  );
  const [previewUnlocked, setPreviewUnlocked] = useState(initialPreview);
  // An improved preview counts as present unless its URL failed to load.
  const [brokenImprovedSrc, setBrokenImprovedSrc] = useState<string | null>(null);

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
  const hasImprovement = Boolean(
    canShowImprovement && improvedSrc && improvedSrc !== brokenImprovedSrc
  );
  const generatedPreviewExists = Boolean(improvedSrc && hasImprovement);
  const previewActive =
    canShowImprovement &&
    hasImprovement &&
    previewUnlocked &&
    activeTab === "preview";
  const activeAudit =
    previewActive && state.improvedAudit ? state.improvedAudit : state;
  const { editSource, editImageSrc, editAudit } = deriveEditContext({
    activeTab,
    hasImprovement,
    improvedSrc,
    uploadedSrc,
    stateImageSrc: state.imageSrc,
    stateAudit: state,
    improvedAudit: state.improvedAudit,
  });
  const editSuggestedChips = buildEditSuggestionChips(
    editAudit.nextSteps,
    editAudit.overallScore
  );

  const scoreDeltaLabel =
    previewActive
      ? `${state.overallScore.toFixed(1)} -> ${activeAudit.overallScore.toFixed(1)}`
      : "";
  const previewBelowPublishReady = previewActive && activeAudit.overallScore < 8;
  // Tab-independent: is a background attempt visibly running? At 8.0+ nothing
  // may render as "running" on either tab.
  const improvedBelowBar = state.improvedAudit
    ? state.improvedAudit.overallScore < 8
    : true;
  const refiningVisible = backgroundRefining && improvedBelowBar;

  // Unified action rule (main + supporting behave identically):
  //   One-click fix is available ONLY for a real product photo that can still
  //   improve (parent passes onImprove), scores below 8, and has no preview yet.
  //   Whenever it is not available (digital, graphic, strong, or already
  //   improved), the slot becomes "Score another photo". Edit is always offered
  //   when the parent allows it.
  const oneClickAvailable =
    Boolean(onImprove) && canShowImprovement && !generatedPreviewExists;
  // The generated candidate's own re-scored value (null until it exists).
  const improvedScoreValue = state.improvedAudit?.overallScore;
  // Only claim "better than your original" when the candidate ACTUALLY beat the
  // original. A worse/equal candidate is kept unselected (see keep-better), so
  // the message must not contradict the score delta shown next to it.
  const previewBeatsOriginal =
    typeof improvedScoreValue === "number" &&
    improvedScoreValue > state.overallScore;
  const backgroundImproveMessage = generatedPreviewExists
    ? previewBeatsOriginal
      ? "This version is better than your original, but we think we can do even better."
      : "Your original still scores higher, so we kept it. We are still trying to beat it in the background."
    : "Still improving your photo in the background.";

  const editPhotoButton = onEdit ? (
    <button
      type="button"
      onClick={() => setEditModalOpen(true)}
      aria-label="AI Edit"
      title="Type what you want changed and AI redraws it."
      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-all hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]"
    >
      <Wrench className="h-4 w-4" aria-hidden="true" />
      AI Edit
    </button>
  ) : null;

  // Hidden per founder decision (2026-08-27): redundant with the dashboard,
  // which already gets a seller back to score another photo. Logic/wiring
  // (onCta, PrimaryButton) kept intact, not deleted, for a smarter future
  // version of this CTA -- SHOW_SCORE_ANOTHER_BUTTON is the one switch.
  const SHOW_SCORE_ANOTHER_BUTTON = false;
  const scoreAnotherButton = SHOW_SCORE_ANOTHER_BUTTON ? (
    <PrimaryButton onClick={onCta} variant="primary">
      Score another photo
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </PrimaryButton>
  ) : null;

  // A NEWLY ARRIVED preview must PRESENT itself: after a refresh mid-flow the
  // workspace mounts locked, and the polled attempt-1 result used to appear
  // silently behind a hidden toggle. Any improvedSrc transition now unlocks
  // and switches to the preview tab (deferred callback keeps lint's
  // no-sync-setState-in-effect rule satisfied).
  const prevImprovedSrcRef = useRef(improvedSrc);
  useEffect(() => {
    const prev = prevImprovedSrcRef.current;
    prevImprovedSrcRef.current = improvedSrc;
    if (!improvedSrc || improvedSrc === prev) return;
    const id = window.setTimeout(() => {
      setPreviewUnlocked(true);
      setActiveTab("preview");
    }, 0);
    return () => window.clearTimeout(id);
  }, [improvedSrc]);

  // Probe the preview URL in the background; a broken URL demotes the toggle
  // back to the original. setState happens only in the async error callback.
  useEffect(() => {
    if (!canShowImprovement || !improvedSrc) return;
    let cancelled = false;
    const probe = new window.Image();
    probe.onerror = () => {
      if (!cancelled) {
        setBrokenImprovedSrc(improvedSrc);
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
    const start = Date.now();
    const reset = window.setTimeout(() => setBackgroundElapsed(0), 0);
    const tick = window.setInterval(
      () => setBackgroundElapsed(Math.floor((Date.now() - start) / 1000)),
      1000
    );
    return () => {
      window.clearTimeout(reset);
      window.clearInterval(tick);
    };
  }, [backgroundRefining]);

  const backgroundRemaining = IMPROVE_ESTIMATE_SECONDS - backgroundElapsed;
  const backgroundCountdown =
    backgroundRemaining > 0
      ? `About ${backgroundRemaining}s remaining`
      : "Finishing up…";

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
                title="Edit however you like."
                className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-[rgba(25,23,20,0.78)] px-4 py-2 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(25,23,20,0.20)] backdrop-blur-sm transition-all hover:bg-[rgba(25,23,20,0.9)]"
              >
                <Wrench className="h-4 w-4" aria-hidden="true" />
                Edit
              </button>
            )}
            {/* Download chip, twin of Edit: saves exactly the photo currently
                on screen (shown tab/version of THIS photo). */}
            {!improveLoading && editImageSrc && (
              <button
                type="button"
                onClick={async () => {
                  const url = editImageSrc;
                  try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(String(res.status));
                    const blob = await res.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = objectUrl;
                    a.download = "mavya-photo.png";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(objectUrl);
                  } catch {
                    window.open(url, "_blank", "noopener");
                  }
                }}
                className="absolute bottom-4 right-4 inline-flex items-center gap-2 rounded-full bg-[rgba(25,23,20,0.78)] px-4 py-2 text-[14px] font-semibold text-white shadow-[0_8px_20px_rgba(25,23,20,0.20)] backdrop-blur-sm transition-all hover:bg-[rgba(25,23,20,0.9)]"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download
              </button>
            )}
            {/* Version picker: Original + last 5 generated versions, newest
                first, persisted on pick. */}
            {versionOptions && versionOptions.length >= 2 && onSelectVersion && (
              <div className="absolute right-3 top-3">
                <button
                  type="button"
                  aria-label="Photo versions"
                  aria-expanded={versionMenuOpen}
                  disabled={versionBusy}
                  onClick={() => setVersionMenuOpen((v) => !v)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[var(--color-ink)] shadow-[var(--shadow-soft)] backdrop-blur-sm transition-colors hover:bg-white disabled:opacity-60"
                >
                  {versionBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
                {versionMenuOpen && (
                  <>
                    <button
                      type="button"
                      aria-hidden="true"
                      tabIndex={-1}
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setVersionMenuOpen(false)}
                    />
                    <div className="absolute right-0 top-11 z-30 w-60 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white py-1 shadow-[var(--shadow-soft-strong)]">
                      {versionOptions.map((opt) => (
                        <button
                          key={opt.jobId ?? "original"}
                          type="button"
                          disabled={versionBusy || opt.current}
                          onClick={() => {
                            setVersionMenuOpen(false);
                            if (opt.current) return;
                            onSelectVersion(opt.jobId);
                            if (opt.jobId) {
                              setPreviewUnlocked(true);
                              setActiveTab("preview");
                            } else {
                              setActiveTab("original");
                            }
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[var(--color-page-deep)] disabled:cursor-default disabled:hover:bg-white"
                        >
                          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                            {opt.current && (
                              <Check
                                className="h-4 w-4 text-[var(--color-primary)]"
                                aria-hidden="true"
                              />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px] font-semibold text-[var(--color-ink)]">
                              {opt.label}
                            </span>
                            {opt.sub && (
                              <span className="block text-[12px] text-[var(--color-ink-soft)]">
                                {opt.sub}
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
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
            coverageState?.status === "legacy" &&
            (checklistLoading ||
              checklistError ||
              (state.supportingChecklist &&
                state.supportingChecklist.length > 0)) && (
              <PhotoChecklistPanel
                checklist={state.supportingChecklist ?? []}
                loading={checklistLoading}
                error={checklistError}
                onRetry={onChecklistRetry}
                coveredShotIds={coveredShotIds}
              />
            )}
          {!isExtra &&
            coverageState &&
            (coverageState.status === "ready" ||
              coverageState.status === "still_checking") && (
              <BuyerQuestionCoveragePanel
                coverageState={coverageState}
                checkedQuestionIds={
                  checkedBuyerQuestionIds ?? EMPTY_CHECKED_QUESTION_IDS
                }
                onToggleQuestion={onToggleBuyerQuestion ?? NOOP}
              />
            )}
          {/* coverageState is undefined only on the landing-page demo (no real
              coverage data exists there) -- same legacy-checklist behavior as
              before this slice, completely unaffected. */}
          {!isExtra &&
            !coverageState &&
            (checklistLoading ||
              checklistError ||
              (state.supportingChecklist &&
                state.supportingChecklist.length > 0)) && (
              <PhotoChecklistPanel
                checklist={state.supportingChecklist ?? []}
                loading={checklistLoading}
                error={checklistError}
                onRetry={onChecklistRetry}
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
                  AI-improved preview, saved to this product. Review labels, text,
                  patterns, personalization, measurements, colors, and included pieces
                  before using this photo.
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

          {contextBanner && (
            <div
              className="reveal-item rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]"
              data-reveal-order="2"
            >
              {contextBanner}
            </div>
          )}

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
            {/* Kept-original note: a first improve (or retry) that scored at or
                below the current version keeps it and shows this honest note in
                the non-preview state, where the preview-tab note above does not
                render. */}
            {keepNote && !previewActive && !improveLoading && !refiningVisible && (
              <div className="mb-3 max-w-[620px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                {keepNote}
              </div>
            )}
            {improveLoading && !previewActive ? (
              // Generating with no preview yet (fresh improve OR an edit from
              // the original). A manual EDIT always shows the white Edit-style
              // countdown; One-click fix keeps the orange CTA treatment.
              <div className="flex flex-wrap items-center gap-3">
                {editLoading ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex cursor-wait items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink-muted)]"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {improveCountdown}
                  </button>
                ) : (
                  <PrimaryButton onClick={() => undefined} variant="primary" disabled>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {improveCountdown}
                  </PrimaryButton>
                )}
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
                {/* While a background attempt runs, "try a different source
                    photo" advice is contradictory — the refining status below
                    is the only message until the workflow settles. */}
                {freePreview && freePreviewMessage && !backgroundRefining && (
                  <div className="max-w-[620px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                    {boldAIEdit(freePreviewMessage)}
                  </div>
                )}
                {/* Background refinement stays SUBTLE: the white countdown
                    button below is the only running indicator (no banner). */}
                {!refiningVisible && keepNote && previewBelowPublishReady ? (
                  <div className="max-w-[620px] rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3 py-2 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                    {keepNote}
                  </div>
                ) : null}
                {improveLoading || refiningVisible ? (
                  // A running generation (seller edit/retry, or a background
                  // refinement below the 8.0 bar): the white Edit-style button
                  // becomes a disabled loading state with the same countdown
                  // treatment as One-click fix. At 8.0+ nothing renders as
                  // "running" — a stray older attempt finishing in the
                  // background can only quietly keep-better.
                  <div className="flex flex-col items-start gap-2">
                    {!improveLoading && refiningVisible && (
                      <span
                        className="text-[12.5px] text-[var(--color-ink-soft)]"
                        role="status"
                        aria-live="polite"
                      >
                        {backgroundImproveMessage}
                      </span>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        disabled
                        className="inline-flex cursor-wait items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink-muted)]"
                      >
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {improveLoading ? improveCountdown : backgroundCountdown}
                      </button>
                      {improveLoading && (
                        <span
                          className="text-[12.5px] text-[var(--color-ink-soft)]"
                          aria-live="polite"
                        >
                          {improveStatus}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-3">
                    {editPhotoButton}
                    {scoreAnotherButton}
                  </div>
                )}
              </div>
            ) : refiningVisible && !improveLoading ? (
              // Background attempt running on the original tab: white generating
              // state, honest message (never claims improvement it did not make).
              <div className="flex flex-col items-start gap-2">
                <span
                  className="text-[12.5px] text-[var(--color-ink-soft)]"
                  role="status"
                  aria-live="polite"
                >
                  {backgroundImproveMessage}
                </span>
                <button
                  type="button"
                  disabled
                  className="inline-flex cursor-wait items-center gap-2 rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink-muted)]"
                >
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {backgroundCountdown}
                </button>
              </div>
            ) : oneClickAvailable ? (
              // Real product photo below 8, not yet improved: One-click fix is the
              // primary action; Edit sits beside it.
              <div className="flex flex-wrap items-center gap-3">
                <PrimaryButton
                  onClick={async () => {
                    if (onImprove) {
                      await onImprove();
                      setPreviewUnlocked(true);
                      setActiveTab("preview");
                    }
                  }}
                  variant="primary"
                  disabled={improveLoading}
                  title="We generate the best version of your existing photo. Your original is always preserved."
                >
                  {improveLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <WandSparkles className="h-4 w-4" aria-hidden="true" />
                  )}
                  {improveLoading ? improveCountdown : "One-click fix"}
                </PrimaryButton>
                {editPhotoButton}
              </div>
            ) : (
              // One-click fix not available (strong, digital, graphic, or already
              // improved): Edit + Score another photo, same for main and supporting.
              <div className="flex flex-wrap items-center gap-3">
                {editPhotoButton}
                {scoreAnotherButton}
              </div>
            )}
          </div>
          )}
            </>
          )}
          {isExtra && onRemovePhoto && (
            <div className="mt-2 border-t border-[var(--color-border-soft)] pt-3">
              <button
                type="button"
                onClick={onRemovePhoto}
                className="text-[13px] font-semibold text-[var(--color-weak)] underline-offset-2 hover:underline"
              >
                Remove this supporting photo
              </button>
            </div>
          )}
        </section>
      </div>

      {editModalOpen && onEdit && editImageSrc && (
        <EditPhotoModal
          imageSrc={editImageSrc}
          loading={improveLoading}
          mode={isExtra ? "extra" : "main"}
          suggestedChips={editSuggestedChips}
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
  title,
}: {
  onClick: () => void | Promise<void>;
  variant: "primary" | "neutral";
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
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
