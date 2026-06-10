"use client";

import Image from "next/image";
import { useState } from "react";

type Props = {
  src: string;
  alt: string;
  overrideSrc?: string;
  headline: string;
  sub: string;
  contain?: boolean;
};

export function MarketplaceThumbnailPreview({
  src,
  alt,
  overrideSrc,
  headline,
  sub,
  contain = false,
}: Props) {
  const finalSrc = overrideSrc ?? src;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border-soft)] bg-white px-4 py-4">
      <div className="eyebrow mb-3">Etsy search preview</div>
      <div className="flex items-center gap-4">
        <div className="relative h-[96px] w-[96px] flex-shrink-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-page-deep)] shadow-[0_1px_2px_rgba(25,23,20,0.05)]">
          <ThumbnailImage
            key={finalSrc}
            src={finalSrc}
            alt={alt}
            contain={contain}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold leading-[1.3] text-[var(--color-ink)]">
            {headline}
          </p>
          {sub && (
            <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-ink-muted)]">
              {sub}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ThumbnailImage({
  src,
  alt,
  contain,
}: {
  src: string;
  alt: string;
  contain: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="h-full w-full"
        style={{
          background: "linear-gradient(135deg, #F5EFE7 0%, #E8DECF 100%)",
        }}
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      className={contain ? "object-contain" : "object-cover"}
      sizes="96px"
      unoptimized={src.startsWith("blob:")}
      onError={() => setFailed(true)}
    />
  );
}
