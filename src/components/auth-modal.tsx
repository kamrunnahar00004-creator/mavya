"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { loadPendingPhoto } from "@/lib/pending-photo";
import { cn } from "@/lib/utils";

/**
 * Paid-only beta routing after a successful sign-in (server-verified via
 * /api/billing/status — never a client flag):
 *  - pending landing photo -> "/" so the stash resumes (subscribe if unpaid)
 *  - active subscriber     -> /dashboard
 *  - past_due              -> /dashboard (warning shown there; AI is blocked
 *                             server-side)
 *  - everyone else         -> /subscribe
 */
async function postAuthDestination(): Promise<string> {
  let hasPendingPhoto = false;
  try {
    hasPendingPhoto = Boolean(await loadPendingPhoto());
  } catch {
    // Stash unavailable: billing routing decides alone.
  }
  try {
    const res = await fetch("/api/billing/status");
    if (!res.ok) return "/subscribe";
    const body = (await res.json()) as { active?: boolean; reason?: string };
    if (body.active) return hasPendingPhoto ? "/" : "/dashboard";
    if (body.reason === "past_due") return "/dashboard";
    return "/subscribe";
  } catch {
    // Status unreachable: the dashboard's server gate re-checks anyway.
    return "/dashboard";
  }
}

type Mode = "login" | "signup";

type Props = {
  initialMode?: Mode;
  onClose: () => void;
};

/**
 * Auth modal — email/password + Google, login and signup in one overlay. Email is
 * the login identifier; username is an optional display handle on signup. All
 * access control is enforced by Supabase RLS server-side; this is only the UI.
 */
export function AuthModal({ initialMode = "signup", onClose }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignup = mode === "signup";

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleGoogle() {
    setError(null);
    setLoading(true);
    try {
      // A pending landing photo must survive the OAuth round-trip: send the
      // callback back to the landing so the stash resumes automatically.
      let redirectTo = `${window.location.origin}/auth/callback`;
      try {
        if (await loadPendingPhoto()) {
          redirectTo += `?next=${encodeURIComponent("/")}`;
        }
      } catch {
        // Stash unavailable: default callback routing applies.
      }
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) throw error;
      // Browser redirects to Google; nothing else to do.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
      setLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setNotice(null);

    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (isSignup) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: username.trim() ? { username: username.trim() } : undefined,
          },
        });
        if (error) throw error;
        // If email confirmation is required, there is no active session yet.
        if (!data.session) {
          setNotice("Check your email to confirm your account, then log in.");
          setLoading(false);
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
      router.push(await postAuthDestination());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setLoading(false);
    }
  }

  // The header's backdrop-filter makes it a containing block for position:fixed
  // descendants, so portal the overlay to <body> to cover the full viewport.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isSignup ? "Create your account" : "Log in"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,13,11,0.55)] px-4 py-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-[460px] overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-soft-strong)] sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-ink-soft)] hover:bg-[var(--color-page-deep)] hover:text-[var(--color-ink)]"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <h2 className="text-[24px] font-bold tracking-[-0.02em] text-[var(--color-ink)]">
          {isSignup ? "Create your account" : "Welcome back"}
        </h2>
        <p className="mt-1 text-[14px] text-[var(--color-ink-muted)]">
          {isSignup
            ? "Score and improve your Etsy listing photos."
            : "Log in to continue."}
        </p>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-4 py-3 text-[14.5px] font-semibold text-[var(--color-ink)] transition-colors hover:bg-[var(--color-page-deep)] disabled:opacity-60"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-[var(--color-border-soft)]" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-soft)]">
            or
          </span>
          <span className="h-px flex-1 bg-[var(--color-border-soft)]" />
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          {isSignup && (
            <Field label="Username (optional)">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                className={inputClass}
                placeholder="yourshopname"
              />
            </Field>
          )}
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className={inputClass}
              placeholder="you@example.com"
            />
          </Field>
          <Field
            label="Password"
            aside={
              !isSignup ? (
                <span className="text-[12.5px] text-[var(--color-ink-soft)]">
                  Forgot password?
                </span>
              ) : undefined
            }
          >
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                required
                className={cn(inputClass, "pr-11")}
                placeholder={isSignup ? "At least 8 characters" : "••••••••"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
              >
                {showPassword ? (
                  <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
                ) : (
                  <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
                )}
              </button>
            </div>
          </Field>
          {isSignup && (
            <Field label="Confirm password">
              <input
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className={inputClass}
                placeholder="Re-enter password"
              />
            </Field>
          )}

          {error && (
            <p className="text-[13px] font-medium text-[var(--color-weak)]">{error}</p>
          )}
          {notice && (
            <p className="text-[13px] font-medium text-[var(--color-ink)]">{notice}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-5 py-3 text-[15px] font-semibold text-white shadow-[0_4px_12px_rgba(232,107,57,0.30)] transition-all hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        <p className="mt-5 text-center text-[13.5px] text-[var(--color-ink-muted)]">
          {isSignup ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => switchMode(isSignup ? "login" : "signup")}
            className="font-semibold text-[var(--color-primary)] hover:underline"
          >
            {isSignup ? "Log in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>,
    document.body
  );
}

const inputClass =
  "w-full rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-white px-3.5 py-2.5 text-[15px] text-[var(--color-ink)] outline-none transition-colors focus:border-[var(--color-primary)] placeholder:text-[var(--color-ink-soft)]";

function Field({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-[var(--color-ink-muted)]">
          {label}
        </span>
        {aside}
      </span>
      {children}
    </label>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}
