"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  src: string;
  alt: string;
  /** demo asset filename to show in placeholder when image is missing */
  placeholderLabel?: string;
  placeholderSub?: string;
  /** override slot when seller-uploaded photo should be shown instead of demo image */
  overrideSrc?: string;
  /** when true, use contain instead of cover (used by full-frame media) */
  contain?: boolean;
};

export function MediaProofPanel({
  src,
  alt,
  placeholderLabel,
  placeholderSub,
  overrideSrc,
  contain = true,
}: Props) {
  const finalSrc = overrideSrc ?? src;

  return (
    <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)]">
      <div className="relative h-[clamp(430px,calc(100vh-300px),580px)] w-full bg-[var(--color-page-deep)]">
        <MediaAsset
          key={finalSrc}
          src={finalSrc}
          alt={alt}
          contain={contain}
          placeholderLabel={placeholderLabel}
          placeholderSub={placeholderSub}
        />
      </div>
    </div>
  );
}

function MediaAsset({
  src,
  alt,
  contain,
  placeholderLabel,
  placeholderSub,
}: {
  src: string;
  alt: string;
  contain: boolean;
  placeholderLabel?: string;
  placeholderSub?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <AssetMissing label={placeholderLabel} sub={placeholderSub} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      className={cn(contain ? "object-contain" : "object-cover")}
      sizes="(max-width: 1280px) 540px, 580px"
      priority
      unoptimized={src.startsWith("blob:")}
      onError={() => setFailed(true)}
    />
  );
}

function AssetMissing({ label, sub }: { label?: string; sub?: string }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center"
      style={{
        background:
          "linear-gradient(135deg, #F5EFE7 0%, #E8DECF 100%)",
      }}
    >
      {label && (
        <div className="font-mono text-sm font-semibold text-[var(--color-ink)]">
          {label}
        </div>
      )}
      {sub && (
        <div className="text-xs text-[var(--color-ink-muted)]">{sub}</div>
      )}
      {!label && !sub && (
        <div className="text-xs text-[var(--color-ink-muted)]">
          Image asset missing
        </div>
      )}
    </div>
  );
}
