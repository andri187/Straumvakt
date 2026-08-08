"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * Sprint 5.8 — invite-accept form. Recipient sets a password,
 * we POST to /api/public/invites/consume, on success redirect to
 * /login with the email pre-filled.
 *
 * Password rules: 8+ chars + match confirm. Server enforces
 * 8-128. We don't enforce composition (caps/digits/etc.) — modern
 * guidance favours length + breach screening over composition
 * rules; breach screening lands separately.
 */
export function InviteAcceptForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password.length > 128) {
      setError("Password must be at most 128 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/public/invites/consume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (body.error === "expired") {
          throw new Error("This invitation has expired.");
        }
        if (body.error === "already_used") {
          throw new Error("This invitation has already been accepted.");
        }
        if (body.error === "not_found") {
          throw new Error("Invitation not found.");
        }
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // Redirect to /login with email pre-filled. The recipient's
      // first sign-in uses the password they just set (Path B in
      // the login route — UserCredential lookup).
      router.push(`/login?email=${encodeURIComponent(email)}&accepted=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <p className="rounded border border-rose-500/40 bg-rose-950/20 p-2 text-[11px] text-rose-200">
          {error}
        </p>
      )}
      <label className="block text-xs">
        <span className="mb-1 block text-ink-400">Set a password</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-sm text-ink-100 focus:border-sv-sky focus:outline-none"
        />
      </label>
      <label className="block text-xs">
        <span className="mb-1 block text-ink-400">Confirm password</span>
        <input
          type="password"
          required
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-sm text-ink-100 focus:border-sv-sky focus:outline-none"
        />
      </label>
      <button
        type="submit"
        disabled={busy || password.length < 8 || password !== confirm}
        className="w-full rounded-md border border-sv-sky/40 bg-sv-sky/10 px-3 py-2 text-sm font-medium text-sv-sky hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Accepting…" : "Accept invitation"}
      </button>
    </form>
  );
}
