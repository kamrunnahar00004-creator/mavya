"use client";

import { ActiveProcessingState } from "./active-processing-state";

type Props = {
  imageSrc?: string;
  imageAlt?: string;
};

const STATUSES = [
  "Improving your photo…",
  "Refining lighting and background…",
  "Re-checking the result…",
];

export function GeneratingState({ imageSrc, imageAlt = "" }: Props) {
  return (
    <ActiveProcessingState
      title="Generating"
      imageSrc={imageSrc}
      imageAlt={imageAlt}
      statuses={STATUSES}
    />
  );
}
