"use client";

import { cn } from "@/lib/utils";

type Props = {
  improvedSrc: string;
  mode?: "slider" | "toggle";
  activeTab: "original" | "preview";
  onTabChange: (tab: "original" | "preview") => void;
};

export function ComparisonPreview({
  mode = "toggle",
  activeTab,
  onTabChange,
}: Props) {
  // Slider implementation deferred until faithful aligned asset confirmed
  void mode;

  return (
    <div className="flex gap-1 rounded-full border border-[var(--color-border)] bg-white p-1 shadow-[0_1px_2px_rgba(25,23,20,0.04)]">
      <TabButton
        active={activeTab === "original"}
        onClick={() => onTabChange("original")}
      >
        Original
      </TabButton>
      <TabButton
        active={activeTab === "preview"}
        onClick={() => onTabChange("preview")}
      >
        AI-improved preview
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-full px-4 py-2 text-[13px] font-semibold transition-all",
        active
          ? "bg-[var(--color-page-deep)] text-[var(--color-ink)] ring-1 ring-inset ring-[var(--color-border)]"
          : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
      )}
    >
      {children}
    </button>
  );
}
