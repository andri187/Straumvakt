"use client";

// straumvakt.org root — 2026-08-08 relaunch.
//
// This replaces the old combined marketing-hero + host/driver login page
// (saved at archive/straumvakt-org-console-2026-08-08/app/page.tsx.original)
// with a single, minimal login. Deliberately simplified from what was here:
//
//   - No driver bearer-login fallback. The mobile app is the driver UI now;
//     a web login attempt only ever tries the admin/host (cookie) path.
//   - No links out to the old console, host portal, or anything else parked
//     in archive/straumvakt-org-console-2026-08-08/ — there's nowhere for
//     them to go yet.
//   - No marketing hero / electronic-ID tab. Just email + password.
//
// On success this lands on /home, a placeholder until the Straumvakt-
// employee and per-org (starting with N1) landing pages replace it with
// real, persona-specific destinations.

import { FormEvent, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { apiFetch } from "@/lib/api-client";

function StraumvaktMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="svRootBolt" x1="40" y1="20" x2="80" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8EF5C7" />
          <stop offset="100%" stopColor="#6FDCEA" />
        </linearGradient>
      </defs>
      <path
        d="M 84 18 L 54 18 A 24 24 0 0 0 30 42 L 30 60"
        stroke="#3EE9A7"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 36 102 L 66 102 A 24 24 0 0 0 90 78 L 90 60"
        stroke="#2BB6E8"
        strokeWidth="13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M 66 28 L 44 66 L 58 66 L 52 96 L 78 56 L 62 56 Z" fill="url(#svRootBolt)" />
    </svg>
  );
}

export default function RootPage() {
  const { language } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        window.location.href = "/home";
        return;
      }
      setError(
        language === "is" ? "Rangt netfang eða lykilorð." : "Wrong email or password.",
      );
    } catch {
      setError(
        language === "is"
          ? "Náði ekki sambandi við innskráningarþjónustu."
          : "Could not reach the login service.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-brand-halo"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-bg-border bg-bg-surface/90 p-8 shadow-card backdrop-blur">
        <div className="flex items-center gap-3">
          <StraumvaktMark className="h-11 w-11" />
          <div>
            <div className="sv-wordmark text-xl font-bold leading-tight">Straumvakt</div>
            <div className="sv-tagline">Control · Overview · Convenience</div>
          </div>
        </div>

        <h1 className="mt-8 text-xl font-semibold text-ink-50">
          {language === "is" ? "Skrá inn" : "Sign in"}
        </h1>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label htmlFor="email" className="mb-1 block text-xs font-medium text-ink-200">
              {language === "is" ? "Netfang" : "Email"}
            </label>
            <input
              id="email"
              type="text"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 outline-none ring-0 placeholder:text-ink-400 focus:border-brand-500/50"
              placeholder="netfang@…"
              required
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-xs font-medium text-ink-200">
              {language === "is" ? "Lykilorð" : "Password"}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 outline-none ring-0 placeholder:text-ink-400 focus:border-brand-500/50"
              required
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-bg-base transition hover:bg-brand-400 disabled:opacity-60"
          >
            {loading
              ? (language === "is" ? "Skrái inn…" : "Signing in…")
              : (language === "is" ? "Skrá inn" : "Sign in")}
          </button>
        </form>
      </div>
    </div>
  );
}
