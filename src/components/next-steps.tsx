import type { NextStep } from "@/data/demo-states";
import { bandColors, type ScoreBand } from "@/lib/utils";

type Props = {
  label: string;
  steps: NextStep[];
  band: ScoreBand;
};

export function NextSteps({ label, steps, band }: Props) {
  // Strong-state label "Add next" reads well; weak/mid "Next steps" stays clear.
  const displayLabel = label === "Add next" ? "Build on this" : label;
  const colors = bandColors(band);

  return (
    <div>
      <div className="eyebrow mb-2.5">{displayLabel}</div>
      <ol className="flex flex-col">
        {steps.map((step, idx) => (
          <li
            key={idx}
            className="grid grid-cols-[26px_1fr] gap-3 py-3.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-[var(--color-border-soft)] first:pt-0 last:pb-0"
          >
            <span
              className="mt-0.5 inline-flex h-[24px] w-[24px] items-center justify-center rounded-full text-[12px] font-bold text-white tabular-nums"
              style={{ background: colors.accent }}
            >
              {idx + 1}
            </span>
            <div>
              <p className="text-[15px] font-bold leading-[1.3] text-[var(--color-ink)]">
                {step.action}
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                {step.observation}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
