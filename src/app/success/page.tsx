"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, Download } from "lucide-react";
import {
  readPendingDownload,
  type PendingDownload,
} from "@/lib/pending-download";

type DownloadState = {
  download: PendingDownload | null;
  loadError: boolean;
  loading: boolean;
};

type PaymentStatus = "checking" | "paid" | "unpaid" | "error";

function triggerDownload(download: PendingDownload) {
  const link = document.createElement("a");
  link.href = download.dataUrl;
  link.download = download.filename || "mavya-improved.png";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const didAutoDownload = useRef(false);
  const [{ download, loadError, loading }, setDownloadState] =
    useState<DownloadState>({
      download: null,
      loadError: false,
      loading: true,
    });
  const [paymentStatus, setPaymentStatus] =
    useState<PaymentStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    async function loadDownload() {
      try {
        const pendingDownload = await readPendingDownload();
        if (cancelled) return;
        setDownloadState({
          download: pendingDownload,
          loadError: !pendingDownload,
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setDownloadState({
            download: null,
            loadError: true,
            loading: false,
          });
        }
      }
    }

    loadDownload();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    async function verifyPayment() {
      try {
        const res = await fetch("/api/verify-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const data = (await res.json().catch(() => null)) as
          | { paid?: boolean }
          | null;
        if (!cancelled) {
          setPaymentStatus(res.ok && data?.paid ? "paid" : "unpaid");
        }
      } catch {
        if (!cancelled) setPaymentStatus("error");
      }
    }

    verifyPayment();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    if (
      paymentStatus !== "paid" ||
      !download ||
      didAutoDownload.current
    ) {
      return;
    }
    didAutoDownload.current = true;
    triggerDownload(download);
  }, [download, paymentStatus]);

  const canDownload = Boolean(download && sessionId && paymentStatus === "paid");
  const statusMessage =
    !sessionId
      ? "Missing checkout session. Go back and use the Download button after generating a photo."
      : loading
      ? "Preparing your download..."
      : loadError
      ? "Could not find the generated photo in this browser. Go back and generate it again before checkout."
      : paymentStatus === "checking"
      ? "Verifying payment..."
      : paymentStatus === "paid"
      ? "Your improved photo should download automatically. Keep this tab open until the download finishes."
      : paymentStatus === "unpaid"
      ? "Payment was not completed. Go back and use the Download button again."
      : "Could not verify payment. Try again from the checkout success link.";

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-[460px] text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-strong-soft)] text-[var(--color-strong)]">
          <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
        </div>
        <h1 className="font-display text-[30px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
          {paymentStatus === "paid" ? "Payment confirmed" : "Final step"}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          {statusMessage}
        </p>

        {canDownload && download ? (
          <button
            type="button"
            onClick={() => triggerDownload(download)}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--color-primary)] px-7 py-3.5 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all hover:bg-[var(--color-primary-hover)] active:translate-y-[1px]"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Download again
          </button>
        ) : (
          <p className="mt-7 text-[14px] leading-relaxed text-[var(--color-weak)]">
            {paymentStatus === "checking" && sessionId && !loadError
              ? "Please wait..."
              : "Download is locked until payment is verified."}
          </p>
        )}

        <div className="mt-8">
          <Link
            href="/"
            className="text-[13px] font-semibold text-[var(--color-ink-muted)] underline-offset-2 hover:underline"
          >
            Score another photo
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[70vh] items-center justify-center px-6 py-16">
          <p className="text-[15px] text-[var(--color-ink-muted)]">
            Preparing your download...
          </p>
        </main>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
