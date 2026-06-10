"use client";

import { ActiveProcessingState } from "./active-processing-state";

type Props = {
  imageSrc?: string;
  imageAlt?: string;
};

const STATUSES = [
  "Reading your photo…",
  "Checking clarity and lighting…",
  "Preparing your score…",
];

export function AnalyzingState({ imageSrc, imageAlt = "" }: Props) {
  return (
    <ActiveProcessingState
      title="Analyzing"
      imageSrc={imageSrc}
      imageAlt={imageAlt}
      statuses={STATUSES}
    />
  );
}
