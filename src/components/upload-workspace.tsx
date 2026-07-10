"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { AlertCircle, Check, ImageUp } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onFile: (file: File) => void;
  errorBanner?: string;
};

const BENEFITS = [
  "Rated in 10 seconds",
  "Fixed in 60 seconds",
  "4x more clicks",
];

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
    <main className="px-6 py-12 sm:py-16 lg:py-[7vh]">
      <div className="mx-auto grid max-w-[1120px] grid-cols-1 items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
        {/* LEFT — message */}
        <div className="text-center lg:text-left">
          <h1 className="font-display text-[38px] font-bold leading-[1.06] tracking-[-0.025em] text-[var(--color-ink)] sm:text-[46px] lg:text-[50px]">
            Your{" "}
            <span style={{ color: "var(--color-primary)" }}>Etsy</span> thumbnail
            decides how much you sell
          </h1>
          <p className="mx-auto mt-5 max-w-[460px] text-[17px] leading-relaxed text-[var(--color-ink-muted)] sm:text-[19px] lg:mx-0">
            Upload your thumbnail for an instant, honest audit.
            <br className="hidden sm:block" /> Find out what is costing you clicks.
            Then fix it in{" "}
            <span
              className="font-bold"
              style={{ color: "var(--color-primary)" }}
            >
              one click
            </span>
            .
          </p>

          <ul className="mx-auto mt-7 flex max-w-[460px] flex-col gap-3 lg:mx-0">
            {BENEFITS.map((b) => (
              <li
                key={b}
                className="flex items-center gap-3 text-[16px] font-semibold text-[var(--color-ink)]"
              >
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
                  <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT — the upload action, the focal point */}
        <div className="flex flex-col gap-3.5">
          {errorBanner && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-4 py-3 text-left text-[14px] text-[var(--color-ink)]"
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
            aria-label="Upload your Etsy thumbnail"
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
              "group flex min-h-[380px] cursor-pointer flex-col items-center justify-center gap-5 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white px-6 py-10 text-center shadow-[var(--shadow-soft)] transition-all sm:min-h-[420px]",
              "hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-soft-strong)]",
              dragActive && "dropzone-active"
            )}
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-[var(--radius-2xl)] bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)] transition-transform duration-200 group-hover:scale-105">
              <ImageUp className="h-10 w-10" strokeWidth={1.7} aria-hidden="true" />
            </span>
            <div>
              <div className="text-[20px] font-bold text-[var(--color-ink)]">
                Drop your thumbnail here
              </div>
              <div className="mt-1 text-[14px] text-[var(--color-ink-muted)]">
                JPG or PNG, and your photo stays private
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openPicker();
              }}
              className="rounded-full bg-[var(--color-primary)] px-8 py-3.5 text-[16px] font-semibold text-white shadow-[0_4px_14px_rgba(232,107,57,0.32)] transition-all hover:bg-[var(--color-primary-hover)] hover:shadow-[0_8px_20px_rgba(216,91,44,0.36)] active:translate-y-[1px]"
            >
              Rate my photo
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
        </div>
      </div>
    </main>
  );
}
