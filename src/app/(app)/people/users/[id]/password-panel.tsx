"use client";

// Sprint 9 — operator-side password set / clear for a User.
// Lives in the Profile tab on the user-detail page. Calls the new
// PUT/DELETE /api/admin/users/:id/password endpoints.
//
// No "current password" challenge — admin reset only. After Set the
// operator copies the password out-of-band (Slack / email / paper).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

interface PasswordPanelProps {
  userId: string;
  hasCredentials: boolean;
}

export function PasswordPanel({ userId, hasCredentials }: PasswordPanelProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"set" | "clear" | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    msg: string;
  } | null>(null);

  async function setPwd(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setFeedback({ kind: "err", msg: "Password must be at least 8 characters." });
      return;
    }
    setBusy("set");
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/password`, {
        method: "PUT",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 80)}` : ""}`);
      }
      setPassword("");
      setFeedback({ kind: "ok", msg: "Password set." });
      router.refresh();
    } catch (err) {
      setFeedback({
        kind: "err",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  async function clearPwd() {
    if (!confirm("Clear this user's password? They won't be able to sign in until a new one is set.")) {
      return;
    }
    setBusy("clear");
    setFeedback(null);
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/password`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 80)}` : ""}`);
      }
      setFeedback({ kind: "ok", msg: "Password cleared. User cannot sign in until a new one is set." });
      router.refresh();
    } catch (err) {
      setFeedback({
        kind: "err",
        msg: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-5 py-4">
      <p className="mb-3 text-[11px] text-ink-500">
        Set a password so this user can sign in to the admin console. The
        password is hashed (PBKDF2-SHA256) before storage; you'll need to copy
        it to the user out-of-band — there's no recovery flow yet. Drivers
        without a sign-in need (pilot inert records per ADR 0006) can leave
        this empty.
      </p>

      <form onSubmit={setPwd} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-ink-500">
            New password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="min 8 chars"
            className="w-full rounded border border-bg-border bg-bg-base/40 px-2 py-1.5 text-sm text-ink-100 outline-none focus:border-sv-sky/50"
            autoComplete="new-password"
            disabled={busy !== null}
          />
        </div>
        <button
          type="submit"
          disabled={busy !== null || password.length < 8}
          className="rounded-md bg-sv-sky/15 px-3 py-1.5 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "set" ? "Setting…" : hasCredentials ? "Replace password" : "Set password"}
        </button>
        {hasCredentials && (
          <button
            type="button"
            onClick={clearPwd}
            disabled={busy !== null}
            className="rounded-md bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "clear" ? "Clearing…" : "Clear password"}
          </button>
        )}
      </form>

      {feedback && (
        <p
          className={
            "mt-2 text-[11px] " +
            (feedback.kind === "ok" ? "text-emerald-300" : "text-rose-300")
          }
        >
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
