"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("This reset link is invalid or expired. Request a new one from Log in.");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-64px)] max-w-[460px] items-center px-6 py-12">
      <section className="w-full rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-7 shadow-[var(--shadow-soft)]">
        <h1 className="text-[24px] font-bold text-[var(--color-ink)]">Set a new password</h1>
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <label className="text-[13px] font-semibold text-[var(--color-ink-muted)]">
            New password
            <input
              autoFocus
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3.5 py-2.5 text-[15px] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          <label className="text-[13px] font-semibold text-[var(--color-ink-muted)]">
            Confirm password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="mt-1.5 w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] px-3.5 py-2.5 text-[15px] outline-none focus:border-[var(--color-primary)]"
            />
          </label>
          {error ? <p role="alert" className="text-[13px] text-[var(--color-weak)]">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-primary)] px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Update password
          </button>
        </form>
      </section>
    </main>
  );
}
