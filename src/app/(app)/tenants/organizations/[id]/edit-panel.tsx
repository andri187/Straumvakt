"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface InitialState {
  displayName: string;
  countryCode: string;
  status: string;
}

export function OrgEditPanel({
  orgId,
  initial,
}: {
  orgId: string;
  initial: InitialState;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [countryCode, setCountryCode] = useState(initial.countryCode);
  const [busy, setBusy] = useState<"idle" | "saving" | "archiving">("idle");
  const [error, setError] = useState<string | null>(null);
  const isArchived = initial.status === "archived";

  async function onSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy("saving");
    try {
      const patch: Record<string, string> = {};
      if (displayName !== initial.displayName) patch.displayName = displayName;
      if (countryCode !== initial.countryCode) patch.countryCode = countryCode;
      if (Object.keys(patch).length === 0) {
        setBusy("idle");
        return;
      }
      const res = await fetch(`/api/admin/orgs/${orgId}`, {
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
      setBusy("idle");
    }
  }

  async function onArchive() {
    if (!window.confirm("Archive this organization? Rows are preserved.")) return;
    setError(null);
    setBusy("archiving");
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/archive`, {
        method: "POST",
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
      setBusy("idle");
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSave} className="space-y-3">
        <Field
          label="Display name"
          value={displayName}
          onChange={setDisplayName}
        />
        <Field
          label="Country"
          mono
          value={countryCode}
          onChange={(v) => setCountryCode(v.toUpperCase().slice(0, 2))}
        />
        {error && (
          <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy !== "idle"}
          className="w-full rounded-md bg-sv-green/20 px-3 py-2 text-sm font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "saving" ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="border-t border-bg-border/40 pt-3">
        {!isArchived ? (
          <button
            type="button"
            onClick={onArchive}
            disabled={busy !== "idle"}
            className="w-full rounded-md bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-300 ring-1 ring-rose-500/20 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "archiving" ? "Archiving…" : "Archive organization"}
          </button>
        ) : (
          <p className="text-xs text-ink-500">
            Archived — kept for audit + foreign-key integrity.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          "mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 ring-1 ring-transparent transition-colors focus:border-sv-sky focus:ring-sv-sky/20 focus:outline-none " +
          (mono ? "font-mono" : "")
        }
      />
    </label>
  );
}
