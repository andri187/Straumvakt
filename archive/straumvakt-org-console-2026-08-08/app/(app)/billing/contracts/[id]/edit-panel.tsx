"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { ContractStatus } from "@straumvakt/shared/domain/contracts";

const STATUS_OPTIONS: ContractStatus[] = [
  "pending_configuration",
  "active",
  "superseded",
  "archived",
];

export function ContractEditPanel({
  contractId,
  initial,
}: {
  contractId: string;
  initial: {
    displayName: string;
    status: ContractStatus;
    /** YYYY-MM-DD */
    validFrom: string;
    /** YYYY-MM-DD or empty for open-ended */
    validUntil: string;
  };
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty =
    state.displayName !== initial.displayName ||
    state.status !== initial.status ||
    state.validFrom !== initial.validFrom ||
    state.validUntil !== initial.validUntil;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (state.displayName !== initial.displayName)
        patch.displayName = state.displayName;
      if (state.status !== initial.status) patch.status = state.status;
      if (state.validFrom !== initial.validFrom) {
        patch.validFrom = new Date(state.validFrom + "T00:00:00Z").toISOString();
      }
      if (state.validUntil !== initial.validUntil) {
        patch.validUntil = state.validUntil
          ? new Date(state.validUntil + "T23:59:59Z").toISOString()
          : null;
      }
      const res = await apiFetch(`/api/admin/contracts/${contractId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setSavedAt(new Date());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
      <h2 className="mb-3 text-sm font-semibold text-ink-50">Edit contract</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-[11px] uppercase tracking-brand text-ink-500">
            Display name
          </span>
          <input
            type="text"
            value={state.displayName}
            onChange={(e) =>
              setState((s) => ({ ...s, displayName: e.target.value }))
            }
            className="mt-1 w-full rounded border border-bg-border bg-bg-base/50 px-3 py-1.5 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-brand text-ink-500">
            Status
          </span>
          <select
            value={state.status}
            onChange={(e) =>
              setState((s) => ({
                ...s,
                status: e.target.value as ContractStatus,
              }))
            }
            className="mt-1 w-full rounded border border-bg-border bg-bg-base/50 px-3 py-1.5 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-brand text-ink-500">
            Valid from
          </span>
          <input
            type="date"
            value={state.validFrom}
            onChange={(e) =>
              setState((s) => ({ ...s, validFrom: e.target.value }))
            }
            className="mt-1 w-full rounded border border-bg-border bg-bg-base/50 px-3 py-1.5 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="text-[11px] uppercase tracking-brand text-ink-500">
            Expires (blank = no expiry)
          </span>
          <input
            type="date"
            value={state.validUntil}
            onChange={(e) =>
              setState((s) => ({ ...s, validUntil: e.target.value }))
            }
            className="mt-1 w-full rounded border border-bg-border bg-bg-base/50 px-3 py-1.5 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
          />
        </label>
      </div>

      {error && (
        <p className="mt-3 rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="rounded bg-sv-sky/10 px-3 py-1.5 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
        {savedAt && !dirty && (
          <span className="text-[11px] text-emerald-300">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
        {dirty && (
          <span className="text-[11px] text-amber-300">Unsaved changes</span>
        )}
      </div>
    </section>
  );
}
