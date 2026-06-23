"use client";

import Image from "next/image";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { PRODUCT_PROOF } from "@/data/product-proof";
import { PillarScores } from "@/components/pillar-scores";
import { bandColors, bandForScore, cn } from "@/lib/utils";

type ProofTab = keyof typeof PRODUCT_PROOF;

export function ProductProofSection() {
  const [activeTab, setActiveTab] = useState<ProofTab>("before");
  const proof = PRODUCT_PROOF[activeTab];
  const colors = bandColors(bandForScore(proof.score));
  const FindingIcon = activeTab === "before" ? X : Check;

  return (
    <section
      aria-labelledby="product-proof-heading"
      className="border-t border-[var(--color-border-soft)] bg-[var(--color-page-deep)]"
    >
      <div className="mx-auto max-w-[1200px] px-6 py-14 sm:py-16 lg:py-20">
        <div className="mx-auto max-w-[700px] text-center">
          <h2
            id="product-proof-heading"
            className="font-display text-[30px] font-bold leading-tight text-[var(--color-ink)] sm:text-[38px]"
          >
            See what buyers see
          </h2>
          <p className="mx-auto mt-3 max-w-[620px] text-[15px] leading-relaxed text-[var(--color-ink-muted)] sm:text-[17px]">
            Mavya scores your Etsy thumbnail, shows what is costing clicks,
            and verifies the improved result.
          </p>
        </div>

        <div
          className="mx-auto mt-8 grid max-w-[1080px] items-start gap-8 lg:mt-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14"
          aria-live="polite"
        >
          <div>
            <div
              className="grid grid-cols-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white p-1 shadow-[0_1px_2px_rgba(25,23,20,0.04)]"
              aria-label="Choose proof photo"
            >
              {(["before", "after"] as const).map((tab) => {
                const active = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    aria-pressed={active}
                    className={cn(
                      "min-h-11 rounded-[calc(var(--radius-lg)-4px)] px-4 text-[14px] font-semibold capitalize transition-colors",
                      active
                        ? "bg-[var(--color-page-deep)] text-[var(--color-ink)] ring-1 ring-inset ring-[var(--color-border)]"
                        : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                    )}
                  >
                    {tab}
                  </button>
                );
              })}
            </div>

            <div className="relative mt-3 aspect-[4/5] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-white shadow-[var(--shadow-soft)]">
              <Image
                key={proof.imageSrc}
                src={proof.imageSrc}
                alt={proof.imageAlt}
                fill
                sizes="(max-width: 1023px) calc(100vw - 48px), 480px"
                className="object-contain"
                priority={false}
              />
              {proof.provenance && (
                <div className="absolute left-3 top-3 rounded-full border border-white/80 bg-white/90 px-3 py-1.5 text-[11px] font-bold text-[var(--color-ink)] shadow-sm backdrop-blur-sm">
                  {proof.provenance}
                </div>
              )}
            </div>
          </div>

          <div className="min-w-0 lg:pt-[58px]">
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--color-border)] pb-5">
              <div>
                <div className="eyebrow">Main photo score</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className="text-[54px] font-extrabold leading-none tabular-nums sm:text-[64px]"
                    style={{ color: colors.accent }}
                  >
                    {proof.score.toFixed(1)}
                  </span>
                  <span className="text-[13px] font-bold uppercase text-[var(--color-ink-soft)]">
                    out of 10
                  </span>
                </div>
              </div>
              <div className="max-w-[250px] pb-1 text-right">
                <div
                  className="text-[10px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: colors.accent }}
                >
                  {colors.label}
                </div>
                <div
                  className="mt-1 text-[20px] font-bold leading-tight sm:text-[22px]"
                  style={{ color: colors.accent }}
                >
                  {proof.verdict}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <PillarScores pillars={proof.pillars} />
            </div>

            <div className="mt-7">
              <div className="eyebrow mb-2.5">
                {activeTab === "before" ? "What needs work" : "What works"}
              </div>
              <ul className="divide-y divide-[var(--color-border-soft)] border-y border-[var(--color-border-soft)]">
                {proof.findings.map((finding) => (
                  <li
                    key={finding}
                    className="flex min-h-14 items-center gap-3 py-3 text-[15px] font-semibold leading-snug text-[var(--color-ink)]"
                  >
                    <span
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full"
                      style={{
                        color: colors.accent,
                        background: colors.soft,
                      }}
                    >
                      <FindingIcon
                        className="h-3.5 w-3.5"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    </span>
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
