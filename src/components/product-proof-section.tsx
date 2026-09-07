"use client";

import Image from "next/image";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { PRODUCT_PROOF_EXAMPLES } from "@/data/product-proof";
import { PillarScores } from "@/components/pillar-scores";
import { bandColors, bandForScore, cn } from "@/lib/utils";

type ProofTab = "before" | "after";

export function ProductProofSection() {
  const [activeExampleId, setActiveExampleId] = useState(
    PRODUCT_PROOF_EXAMPLES[0].id
  );
  const [activeTab, setActiveTab] = useState<ProofTab>("before");
  const activeExample =
    PRODUCT_PROOF_EXAMPLES.find((example) => example.id === activeExampleId) ??
    PRODUCT_PROOF_EXAMPLES[0];
  const proof = activeExample.states[activeTab];
  const colors = bandColors(bandForScore(proof.score));
  const FindingIcon = activeTab === "before" ? X : Check;

  return (
    <section
      aria-labelledby="product-proof-heading"
      className="border-t border-[var(--color-border-soft)] bg-[var(--color-page-deep)]"
    >
      <div className="mx-auto max-w-[1200px] px-4 pb-12 pt-4 sm:px-6 sm:pb-16 sm:pt-10 lg:pb-20 lg:pt-12">
        <div className="mx-auto max-w-[700px] text-center">
          <h2
            id="product-proof-heading"
            className="font-display text-[28px] font-bold leading-tight text-[var(--color-ink)] sm:text-[38px]"
          >
            What buyers see
          </h2>
        </div>

        <div
          className="mx-auto mt-7 grid max-w-[1080px] items-start gap-6 sm:mt-6 sm:gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14"
          aria-live="polite"
        >
          <div>
            {/* Rail + (tabs/image) column. Rail sits ABOVE on mobile (a
                horizontal row, since a vertical rail beside a full-width
                image would force horizontal scroll or squeeze the image on
                a phone) and to the LEFT on desktop, matching Etsy's own
                listing gallery. Only rendered with 2+ examples -- a rail of
                one thumbnail has nothing to switch between. */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
              {PRODUCT_PROOF_EXAMPLES.length > 1 && (
                <div
                  className="flex flex-row gap-2 lg:w-[76px] lg:flex-shrink-0 lg:flex-col lg:gap-3"
                  aria-label="Choose example photo"
                >
                  {PRODUCT_PROOF_EXAMPLES.map((example) => {
                    const isActiveExample = example.id === activeExampleId;
                    const thumb = example.states.after;
                    return (
                      <button
                        key={example.id}
                        type="button"
                        onClick={() => {
                          setActiveExampleId(example.id);
                          setActiveTab("before");
                        }}
                        aria-pressed={isActiveExample}
                        aria-label={`View the ${thumb.tabLabel} example`}
                        className={cn(
                          "group relative block h-16 w-16 flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-page-deep)] transition-all lg:h-[76px] lg:w-full",
                          isActiveExample
                            ? "border-2 border-[var(--color-primary)] shadow-[var(--shadow-soft)]"
                            : "border border-[var(--color-border)]"
                        )}
                      >
                        <Image
                          src={thumb.imageSrc}
                          alt=""
                          fill
                          className="object-cover"
                          sizes="76px"
                        />
                        {/* Etsy's own gallery marks the active thumbnail with
                            just a border and leaves the rest plain -- no
                            caption row under each tile. With the label gone,
                            a wash on the INACTIVE tiles does the same job:
                            the selected one visibly pops without needing
                            text. Lightens on hover as a press affordance. */}
                        {!isActiveExample && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-0 bg-white/55 transition-colors group-hover:bg-white/25"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="min-w-0 flex-1">
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
                          "min-h-11 rounded-[calc(var(--radius-lg)-4px)] px-4 text-[14px] font-semibold transition-colors",
                          active
                            ? "bg-[var(--color-page-deep)] text-[var(--color-ink)] ring-1 ring-inset ring-[var(--color-border)]"
                            : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                        )}
                      >
                        {activeExample.states[tab].tabLabel}
                      </button>
                    );
                  })}
                </div>

                <div className="relative mt-2.5 aspect-[3/4] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-white shadow-[var(--shadow-soft)] sm:mt-3">
                  <Image
                    key={proof.imageSrc}
                    src={proof.imageSrc}
                    alt={proof.imageAlt}
                    fill
                    sizes="(max-width: 1023px) calc(100vw - 48px), 480px"
                    className="object-contain"
                    priority={false}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 lg:pt-[58px]">
            <div className="grid grid-cols-[auto_1fr] items-end gap-3 border-b border-[var(--color-border)] pb-4 sm:gap-4 sm:pb-5">
              <div>
                <div className="eyebrow">Main photo score</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    className="text-[48px] font-extrabold leading-none tabular-nums sm:text-[64px]"
                    style={{ color: colors.accent }}
                  >
                    {proof.score.toFixed(1)}
                  </span>
                  <span className="text-[11px] font-bold uppercase text-[var(--color-ink-soft)] sm:text-[13px]">
                    out of 10
                  </span>
                </div>
              </div>
              <div className="min-w-0 pb-1 text-right">
                <div
                  className="text-[10px] font-bold uppercase tracking-[0.14em]"
                  style={{ color: colors.accent }}
                >
                  {colors.label}
                </div>
                <div
                  className="mt-1 text-[17px] font-bold leading-tight sm:text-[22px]"
                  style={{ color: colors.accent }}
                >
                  {proof.verdict}
                </div>
              </div>
            </div>

            <div className="mt-5 sm:mt-6">
              <PillarScores pillars={proof.pillars} />
            </div>

            <div className="mt-6 sm:mt-7">
              <div className="eyebrow mb-2.5">
                {activeTab === "before" ? "What needs work" : "What works"}
              </div>
              <ul className="divide-y divide-[var(--color-border-soft)] border-y border-[var(--color-border-soft)]">
                {proof.findings.map((finding) => (
                  <li
                    key={finding}
                    className="flex min-h-12 items-center gap-3 py-2.5 text-[14px] font-semibold leading-snug text-[var(--color-ink)] sm:min-h-14 sm:py-3 sm:text-[15px]"
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
