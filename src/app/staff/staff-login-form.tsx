"use client";

// Sign-in form for the Straumvakt-employee entrance (/staff).
//
// It posts to the same POST /api/admin/login as the org-facing login at "/".
// There is one credential endpoint, not two, and it is deliberately left
// alone: Path A (the env-secret ADMIN_EMAIL/ADMIN_PASSWORD staff account,
// which mints a PlatformGrant) and Path B (an org operator with a
// UserCredential row) both answer `{ ok: true, email }` and both mint the
// same cookie. The endpoint cannot tell the caller which path it took.
//
// So this form does NOT try to decide who you are. It sends every success to
// /staff/overview, which asks GET /api/admin/me whether the session actually
// carries platform scope and says so plainly when it doesn't. That keeps the
// persona check on the one surface that can answer it authoritatively,
// instead of guessing from a login response that is identical either way.
//
// English-only copy on purpose: components/language-provider.tsx forces
// `language === "en"` for V3, so the bilingual ternaries the older login
// forms carry would all collapse to one branch here anyway.

import { FormEvent, useState } from "react";
import { apiFetch } from "@/lib/api-client";

export function StaffLoginForm() {
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
        // Full document navigation rather than router.push: the session
        // cookie is set by the API Worker on a different origin, and
        // middleware only sees it on a fresh request.
        window.location.href = "/staff/overview";
        return;
      }
      if (res.status === 429) {
        // The endpoint rate-limits at 10 attempts / 60s bucketed by
        // email-or-IP. Name that instead of showing "wrong password" to
        // someone whose password is fine.
        setError("Too many attempts. Wait a minute, then try again.");
        return;
      }
      setError("That email and password combination was not accepted.");
    } catch {
      setError("Could not reach the login service.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={onSubmit}>
      <div>
        <label
          htmlFor="staff-email"
          className="mb-1 block text-xs font-medium text-ink-200"
        >
          Email
        </label>
        <input
          id="staff-email"
          type="text"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 outline-none ring-0 placeholder:text-ink-400 focus:border-brand-500/50"
          placeholder="you@straumvakt.is"
          required
        />
      </div>
      <div>
        <label
          htmlFor="staff-password"
          className="mb-1 block text-xs font-medium text-ink-200"
        >
          Password
        </label>
        <input
          id="staff-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm text-ink-50 outline-none ring-0 placeholder:text-ink-400 focus:border-brand-500/50"
          required
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-brand-500 px-3 py-2 text-sm font-semibold text-bg-base transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
