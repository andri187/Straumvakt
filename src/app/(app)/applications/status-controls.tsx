"use client";

// Per-row status control for the operator host-application inbox.
// PATCHes /api/admin/host-applications/:id { status } then refreshes
// the server component so the row moves into its new tab bucket.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { HostApplicationStatus } from "@straumvakt/shared/domain/host-applications";

const STATUS_OPTIONS: { value: HostApplicationStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "in_review", label: "In review" },
  { value: "offered", label: "Offered" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

export function StatusControl({
  id,
  current,
}: {
  id: string;
  current: HostApplicationStatus;
}) {
  const router = useRouter();
  const [value, setValue] = useState<HostApplicationStatus>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onChange(next: HostApplicationStatus) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setError(null);
    setSaving(true);
    try {
      const res = await apiFetch(
        `/api/admin/host-applications/${id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(b?.error || `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setValue(previous);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={value}
        disabled={saving}
        onChange={(e) => onChange(e.target.value as HostApplicationStatus)}
        className="rounded-md border border-bg-border bg-bg-base/50 px-2 py-1 text-xs text-ink-50 focus:border-sv-sky focus:outline-none disabled:opacity-50"
        aria-label="Application status"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-[10px] text-rose-300">{error}</span>}
    </div>
  );
}
