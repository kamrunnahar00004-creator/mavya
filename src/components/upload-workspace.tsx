"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  AlertCircle,
  Check,
  Gauge,
  ImageUp,
  WandSparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  onFile: (file: File) => void;
  errorBanner?: string;
};

const BENEFITS = [
  "Free first audit",
  "No account needed",
  "Results in under a minute",
];

const WHAT_YOU_GET = [
  { icon: Gauge, label: "A 0 to 10 thumbnail score" },
  { icon: Wrench, label: "The one thing to fix first" },
  { icon: WandSparkles, label: "A one-click improved photo" },
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
    <main className="px-6 py-10 sm:py-14 lg:py-[6vh]">
      <div className="mx-auto grid max-w-[1080px] grid-cols-1 items-center gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-14">
        {/* LEFT — message */}
        <div className="text-center lg:text-left">
          <span className="eyebrow">Etsy thumbnail audit</span>
          <h1 className="mt-3 font-display text-[32px] font-bold leading-[1.08] tracking-[-0.02em] text-[var(--color-ink)] sm:text-[40px]">
            Your{" "}
            <span style={{ color: "var(--color-primary)" }}>Etsy</span> thumbnail
            decides who clicks
          </h1>
          <p className="mx-auto mt-4 max-w-[440px] text-[16px] leading-relaxed text-[var(--color-ink-muted)] sm:text-[17px] lg:mx-0">
            Upload it for an instant, honest audit of what is costing you clicks.
            Then fix it in{" "}
            <span
              className="font-bold"
              style={{ color: "var(--color-primary)" }}
            >
              one click
            </span>
            .
          </p>

          <ul className="mx-auto mt-6 flex max-w-[440px] flex-col gap-2.5 lg:mx-0">
            {BENEFITS.map((b) => (
              <li
                key={b}
                className="flex items-center gap-2.5 text-[14.5px] font-medium text-[var(--color-ink)]"
              >
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT — upload + outcome preview */}
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
              "group flex cursor-pointer flex-col items-center gap-3 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white px-6 py-8 text-center shadow-[var(--shadow-soft)] transition-all",
              "hover:border-[var(--color-primary)] hover:shadow-[var(--shadow-soft-strong)]",
              dragActive && "dropzone-active"
            )}
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-[var(--radius-xl)] bg-[var(--color-tint)] text-[var(--color-primary)] ring-1 ring-inset ring-[var(--color-tint-deep)]">
              <ImageUp className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div>
              <div className="text-[16px] font-semibold text-[var(--color-ink)]">
                Drop your thumbnail here
              </div>
              <div className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
                JPG or PNG, and your photo stays private
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openPicker();
              }}
              className="mt-1 rounded-full bg-[var(--color-primary)] px-7 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all hover:bg-[var(--color-primary-hover)] hover:shadow-[0_6px_16px_rgba(216,91,44,0.36)] active:translate-y-[1px]"
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

          {/* Outcome preview — shows the value before uploading */}
          <div className="rounded-[var(--radius-xl)] border border-[var(--color-border-soft)] bg-white/70 px-4 py-3.5">
            <div className="eyebrow mb-2.5">What you get</div>
            <div className="flex flex-col gap-2.5">
              {WHAT_YOU_GET.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-primary)]">
                    <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="text-[13.5px] font-medium text-[var(--color-ink)]">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
