import type { Pillar } from "@/data/demo-states";
import { bandColors, bandForScore } from "@/lib/utils";

type Props = {
  pillars: Pillar[];
};

export function PillarScores({ pillars }: Props) {
  return (
    <div>
      <div className="eyebrow mb-2.5">What buyers see</div>
      <div className="grid grid-cols-2 gap-2.5">
        {pillars.map((p) => (
          <PillarTile key={p.key} pillar={p} />
        ))}
      </div>
    </div>
  );
}

function PillarTile({ pillar }: { pillar: Pillar }) {
  const band = bandForScore(pillar.value);
  const colors = bandColors(band);
  const pct = Math.max(6, Math.min(100, pillar.value * 10));

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] bg-white px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-semibold text-[var(--color-ink)]">
          {pillar.label}
        </div>
        <div className="flex items-baseline gap-0.5">
          <span
            className="text-[24px] font-extrabold leading-none tabular-nums"
            style={{ color: colors.accent }}
          >
            {pillar.value}
          </span>
          <span className="text-[12px] font-medium text-[var(--color-ink-soft)]">
            /10
          </span>
        </div>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border-soft)]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: colors.accent }}
        />
      </div>
    </div>
  );
}
