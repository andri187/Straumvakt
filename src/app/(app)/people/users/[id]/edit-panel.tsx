"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUSES = ["active", "suspended", "deleted"] as const;
type UserStatusValue = (typeof STATUSES)[number];

interface InitialState {
  displayName: string;
  status: string;
}

export function UserEditPanel({
  userId,
  initial,
}: {
  userId: string;
  initial: InitialState;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [status, setStatus] = useState<UserStatusValue>(
    initial.status as UserStatusValue,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const patch: Record<string, string> = {};
      if (displayName !== initial.displayName) {
        patch.displayName = displayName;
      }
      if (status !== initial.status) patch.status = status;
      if (Object.keys(patch).length === 0) {
        setBusy(false);
        return;
      }
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSave} className="space-y-3">
      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
          Display name
        </span>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 ring-1 ring-transparent transition-colors focus:border-sv-sky focus:ring-sv-sky/20 focus:outline-none"
        />
      </label>

      <label className="block">
        <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
          Status
        </span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as UserStatusValue)}
          className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 ring-1 ring-transparent transition-colors focus:border-sv-sky focus:ring-sv-sky/20 focus:outline-none"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
