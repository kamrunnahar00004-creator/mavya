"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { AlertCircle, Check, ImageUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onFile: (file: File) => void;
  errorBanner?: string;
};

export function UploadWorkspace({ onFile, errorBanner }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);

  function openPicker() {
    inputRef.current?.click();
  }

  function handleKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  }

  return (
    <main className="flex min-h-[calc(78dvh-64px)] flex-col items-center justify-start px-4 pb-7 pt-7 sm:min-h-[calc(82dvh-64px)] sm:px-6 sm:pb-10 sm:pt-[5vh]">
      <div className="mx-auto max-w-[1040px] text-center">
        <h1 className="font-display text-[28px] sm:text-[36px] md:text-[42px] font-bold tracking-[-0.02em] leading-[1.1] text-[var(--color-ink)]">
          Your{" "}
          <span style={{ color: "var(--color-primary)" }}>Etsy</span> listing
          thumbnail decides how much you sell
        </h1>
        <p className="mx-auto mt-3 text-[17px] sm:mt-4 sm:text-[22px] font-medium leading-snug text-[var(--color-ink)]">
          Upload your listing thumbnail and get an instant, honest audit.
          <br className="hidden sm:block" /> See exactly what’s costing you
          clicks. Fix it in{" "}
          <span
            className="font-extrabold"
            style={{ color: "var(--color-primary)" }}
          >
            one click
          </span>
          .
        </p>

        {errorBanner && (
          <div
            role="alert"
            className="mx-auto mt-6 flex w-full max-w-[720px] items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-4 py-3 text-left text-[14px] text-[var(--color-ink)]"
          >
            <AlertCircle
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-weak)]"
              strokeWidth={2}
              aria-hidden="true"
            />
            <span>{errorBanner}</span>
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          aria-label="Upload product photo"
          onClick={openPicker}
          onKeyDown={handleKey}
          onDragOver={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragActive(false);
            const file = e.dataTransfer.files?.[0];
            if (file && file.type.startsWith("image/")) onFile(file);
          }}
          className={cn(
            "group mx-auto mt-6 flex h-[248px] w-full max-w-[720px] cursor-pointer flex-col items-center justify-center gap-4 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white px-5 py-6 transition-all sm:mt-8 sm:h-[280px] sm:gap-5 sm:px-6 sm:py-8",
            "shadow-[var(--shadow-soft)]",
            "hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-soft-strong)]",
            dragActive && "dropzone-active"
          )}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)] sm:h-16 sm:w-16">
            <ImageUp className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
          </div>

          <div className="text-center">
            <div className="text-[17px] font-semibold text-[var(--color-ink)]">
              Drop your listing thumbnail
            </div>
            <div className="mt-1 text-[13px] text-[var(--color-ink-muted)]">
              JPG or PNG
            </div>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openPicker();
            }}
            className={cn(
              "rounded-full bg-[var(--color-primary)] px-7 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)]",
              "transition-all hover:bg-[var(--color-primary-hover)] hover:shadow-[0_6px_16px_rgba(216,91,44,0.36)] active:translate-y-[1px]"
            )}
          >
            Upload photo
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFile(file);
            }}
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-[var(--color-ink-muted)] sm:mt-6 sm:gap-x-5 sm:text-[13px]">
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" strokeWidth={2.5} aria-hidden="true" />
            First rating free
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" strokeWidth={2.5} aria-hidden="true" />
            No signup
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-[var(--color-primary)]" strokeWidth={2.5} aria-hidden="true" />
            Quick audit
          </span>
        </div>
      </div>
    </main>
  );
}
