"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Category = "bug" | "complaint" | "feature" | "other";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "bug", label: "Bug" },
  { value: "complaint", label: "Complaint" },
  { value: "feature", label: "Feature request" },
  { value: "other", label: "Other" },
];

const MAX_LEN = 2000;

export default function FeedbackPage() {
  const [authState, setAuthState] = useState<"checking" | "in" | "out">("checking");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<Category>("complaint");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!alive) return;
        setAuthState(user ? "in" : "out");
        if (user?.email) setEmail(user.email);
      } catch {
        if (alive) setAuthState("out");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    setError(null);
    if (!message.trim()) {
      setError("Write a message first.");
      return;
    }
    setStatus("sending");
    try {
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please log in to send feedback.");
      const { error } = await supabase.from("feedback").insert({
        user_id: user.id,
        email: email.trim() || user.email || null,
        category,
        message: message.trim().slice(0, MAX_LEN),
      });
      if (error) throw error;
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Could not send. Try again.");
    }
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-[560px] px-6 py-12">
        <h1 className="text-[26px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
          Send feedback
        </h1>
        <p className="mt-1.5 text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          Bug, complaint, or idea — tell us. We read every message.
        </p>

        {authState === "out" ? (
          <div className="mt-8 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 text-center shadow-[var(--shadow-soft)]">
            <p className="text-[15px] font-semibold text-[var(--color-ink)]">
              Log in to send feedback
            </p>
            <p className="mt-1 text-[13.5px] text-[var(--color-ink-muted)]">
              So we can follow up with you.
            </p>
            <Link
              href="/?auth=login"
              className="mt-4 inline-flex rounded-full bg-[var(--color-primary)] px-5 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              Log in
            </Link>
          </div>
        ) : status === "done" ? (
          <div className="mt-8 flex flex-col items-center rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-8 text-center shadow-[var(--shadow-soft)]">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-strong-soft)] text-[var(--color-strong)]">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            </span>
            <p className="mt-4 text-[17px] font-bold text-[var(--color-ink)]">
              Thank you
            </p>
            <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">
              Your feedback reached us. We will read it.
            </p>
            <Link
              href="/dashboard"
              className="mt-5 inline-flex rounded-full border border-[var(--color-border)] bg-white px-5 py-2.5 text-[14px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)]"
            >
              Back to dashboard
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mt-8 rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft)] sm:p-7"
          >
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--color-ink-muted)]">
                What is this about?
              </span>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-[13.5px] font-semibold transition-colors",
                      category === c.value
                        ? "border-[var(--color-primary)] bg-[var(--color-tint)] text-[var(--color-primary)]"
                        : "border-[var(--color-border)] bg-white text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)]"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </label>

            <label className="mt-5 block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--color-ink-muted)]">
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-[15px] text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
              />
            </label>

            <label className="mt-5 block">
              <span className="mb-1.5 block text-[12.5px] font-semibold text-[var(--color-ink-muted)]">
                Message
              </span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_LEN))}
                rows={6}
                placeholder="Tell us what happened or what you'd like to see…"
                className="w-full resize-none rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-[15px] leading-relaxed text-[var(--color-ink)] outline-none focus:border-[var(--color-primary)]"
              />
              <span className="mt-1 block text-right text-[11.5px] text-[var(--color-ink-soft)]">
                {message.length}/{MAX_LEN}
              </span>
            </label>

            {error && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-[var(--radius-lg)] border border-[var(--color-weak)] bg-[var(--color-weak-soft)] px-3 py-2 text-[13px] text-[var(--color-ink)]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-weak)]" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={status === "sending" || authState === "checking"}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "sending" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Send feedback
            </button>
          </form>
        )}
      </main>
    </>
  );
}
