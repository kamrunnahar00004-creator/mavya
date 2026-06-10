"use client";

import { useEffect, useState } from "react";
import { bandColors, bandForScore, prefersReducedMotion } from "@/lib/utils";

type Props = {
  score: number;
  verdict: string;
  heading?: string;
  animate?: boolean;
};

// Open-arc gauge geometry
const SIZE = 168;
const RADIUS = 66;
const STROKE = 11;
const CIRC = 2 * Math.PI * RADIUS;
const ARC_FRACTION = 0.75;
const ARC_LEN = CIRC * ARC_FRACTION;
const SAFE_GAP = CIRC * 2;

export function ScoreVerdict({
  score,
  verdict,
  heading = "Main photo score",
  animate = true,
}: Props) {
  const [value, setValue] = useState(animate ? 0 : score);

  useEffect(() => {
    if (!animate) return;
    if (prefersReducedMotion()) {
      const raf = requestAnimationFrame(() => setValue(score));
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const duration = 1000;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.min(score, score * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setValue(score);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score, animate]);

  const band = bandForScore(score);
  const colors = bandColors(band);
  const filled = (Math.min(value, 10) / 10) * ARC_LEN;
  const half = SIZE / 2;

  return (
    <div className="flex flex-col items-start">
      <div className="eyebrow mb-3">{heading}</div>

      <div className="flex items-end gap-5">
        <div className={animate ? "gauge-pop" : undefined}>
          <svg
            width={SIZE}
            height={SIZE}
            viewBox={`-${half} -${half} ${SIZE} ${SIZE}`}
            role="img"
            aria-label={`Score ${score.toFixed(1)} out of 10`}
          >
            <circle
              cx={0}
              cy={0}
              r={RADIUS}
              fill="none"
              stroke="var(--color-border)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${ARC_LEN} ${SAFE_GAP}`}
              strokeDashoffset={0}
              transform="rotate(135 0 0)"
            />
            <circle
              cx={0}
              cy={0}
              r={RADIUS}
              fill="none"
              stroke={colors.accent}
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${filled} ${SAFE_GAP}`}
              strokeDashoffset={0}
              transform="rotate(135 0 0)"
            />
            <text
              x={0}
              y={-4}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="50"
              fontWeight="800"
              fill={colors.accent}
              style={{
                fontFamily: "var(--font-sans)",
                letterSpacing: "-0.04em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {value.toFixed(1)}
            </text>
            <text
              x={0}
              y={30}
              textAnchor="middle"
              fontSize="10"
              fontWeight="700"
              fill="var(--color-ink-soft)"
              style={{ letterSpacing: "0.14em" }}
            >
              OUT OF 10
            </text>
          </svg>
        </div>

        <div className="pb-3 flex-1 min-w-0">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: colors.accent }}
          >
            {colors.label}
          </div>
          <div
            className="mt-1 text-[22px] font-bold leading-[1.15] tracking-[-0.01em]"
            style={{ color: colors.accent }}
          >
            {verdict}
          </div>
        </div>
      </div>
    </div>
  );
}
