"use client";

import { useState } from "react";
import { ChevronDown, Circle, CircleCheck, Loader2 } from "lucide-react";
import type { ChecklistDoubt, SupportingPhotoChecklistItem } from "@/lib/rubric";
import { cn } from "@/lib/utils";

const DOUBT_LABEL: Record<ChecklistDoubt, string> = {
  identity: "Clarity",
  scale: "Size",
  quality: "Quality",
  fit: "Fit",
  completeness: "What's included",
  risk: "Trust",
  desire: "Desire",
};

type Props = {
  checklist: SupportingPhotoChecklistItem[];
  /** True while the checklist hydrates in the background (score already shown). */
  loading?: boolean;
  /** Shot ids already covered by uploaded supporting photos (auto-marked "Added"). */
  coveredShotIds?: string[];
};

/**
 * Suggested supporting shots - a quiet, OPTIONAL note under the real workspace
 * (the photo strip). It never uploads or scores anything. The checkmarks are a
 * personal "I've covered this" satisfaction toggle, session-only, with no scoring
 * and no pressure - a seller with no supporting photos never feels they failed.
 */
export function PhotoChecklistPanel({
  checklist,
  loading = false,
  coveredShotIds,
}: Props) {
  const [open, setOpen] = useState(false);
  // Session-only "I've covered this" state, keyed by shot id. No scoring.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const covered = new Set(coveredShotIds ?? []);

  // Nothing to show and nothing coming: render nothing.
  if (!checklist.length && !loading) return null;

  // Score is already visible; the checklist is still hydrating in the background.
  // Show a calm placeholder so the card is present but adds no friction.
  if (!checklist.length && loading) {
    return (
      <div className="flex items-center gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-primary)] bg-white/70 px-4 py-3">
        <Loader2
          className="h-4 w-4 flex-shrink-0 animate-spin text-[var(--color-ink-soft)]"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="text-[13.5px] font-semibold text-[var(--color-ink-muted)]">
            Suggested supporting shots
          </span>
          <span className="mt-0.5 block text-[12px] text-[var(--color-ink-soft)]">
            Preparing ideas for this product...
          </span>
        </span>
      </div>
    );
  }

  const toggle = (shotId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });

  const critical = checklist.filter((item) => item.priority === "critical");
  const recommended = checklist.filter((item) => item.priority !== "critical");

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-primary)] bg-white/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <CircleCheck
          className="h-4 w-4 flex-shrink-0 text-[var(--color-ink-soft)]"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="text-[13.5px] font-semibold text-[var(--color-ink-muted)]">
            Suggested supporting shots
          </span>
          {!open && (
            <span className="mt-0.5 block text-[12px] text-[var(--color-ink-soft)]">
              Optional ideas to make the listing clearer.
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 flex-shrink-0 text-[var(--color-ink-soft)] transition-transform",
            open && "rotate-180"
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="border-t border-[var(--color-border-soft)] px-4 py-3.5">
          <div className="flex flex-col gap-2">
            {critical.map((item, i) => (
              <ChecklistRow
                key={`c-${i}`}
                item={item}
                checked={checked.has(item.shot_id)}
                covered={covered.has(item.shot_id)}
                onToggle={() => toggle(item.shot_id)}
              />
            ))}
          </div>

          {recommended.length > 0 && (
            <>
              <div className="my-3 flex items-center gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
                  Nice to have
                </span>
                <span className="h-px flex-1 bg-[var(--color-border-soft)]" />
              </div>
              <div className="flex flex-col gap-2">
                {recommended.map((item, i) => (
                  <ChecklistRow
                    key={`r-${i}`}
                    item={item}
                    checked={checked.has(item.shot_id)}
                    covered={covered.has(item.shot_id)}
                    onToggle={() => toggle(item.shot_id)}
                  />
                ))}
              </div>
            </>
          )}

          <p className="mt-3.5 text-[11.5px] leading-snug text-[var(--color-ink-soft)]">
            Use these as ideas for the next photos in your listing.
          </p>
        </div>
      )}
    </div>
  );
}

function ChecklistRow({
  item,
  checked,
  covered = false,
  onToggle,
}: {
  item: SupportingPhotoChecklistItem;
  checked: boolean;
  /** Auto-detected from an uploaded supporting photo; not user-toggleable. */
  covered?: boolean;
  onToggle: () => void;
}) {
  const done = covered || checked;
  return (
    <button
      type="button"
      onClick={covered ? undefined : onToggle}
      aria-pressed={done}
      disabled={covered}
      className={cn(
        "flex w-full gap-2.5 rounded-[var(--radius-md)] py-0.5 text-left transition-colors",
        !covered && "hover:bg-[var(--color-page-deep)]/40",
        covered && "cursor-default"
      )}
    >
      {done ? (
        <CircleCheck
          className="mt-[3px] h-4 w-4 flex-shrink-0 text-[var(--color-strong)]"
          aria-hidden="true"
        />
      ) : (
        <Circle
          className="mt-[3px] h-4 w-4 flex-shrink-0 text-[var(--color-border-strong)]"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-[13.5px] font-semibold",
              done
                ? "text-[var(--color-ink-soft)] line-through"
                : "text-[var(--color-ink)]"
            )}
          >
            {item.title}
          </span>
          <span className="rounded-full bg-[var(--color-page-deep)] px-2 py-0.5 text-[10.5px] font-semibold text-[var(--color-ink-muted)]">
            {DOUBT_LABEL[item.answers_doubt]}
          </span>
          {covered && (
            <span className="rounded-full bg-[var(--color-strong-soft)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--color-strong)]">
              Added
            </span>
          )}
        </div>
        {!done && (
          <>
            <p className="mt-0.5 text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
              {item.reason}
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-ink-soft)]">
              Example: {item.how_to}
            </p>
          </>
        )}
      </div>
    </button>
  );
}
