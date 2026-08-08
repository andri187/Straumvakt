"use client";

// Client-side actions for a RateReference detail page.
//
// Allowed mutations depend on row status (ADR 0019 Rule 5):
//
//   "current"  → edit notes only (price/dates are immutable on active row)
//   "staged"   → edit notes + effectiveUntil (no active resolution yet)
//   "expired"  → no actions (component not rendered for expired rows)
//
// Retire: sets effectiveUntil = now(). Creates a resolution gap — operator
// is warned before confirming.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

interface Props {
  rateReferenceId: string;
  status: "current" | "staged";
  currentNotes: string;
  currentEffectiveUntil: string;
}

export function RateReferenceActions({
  rateReferenceId,
  status,
  currentNotes,
  currentEffectiveUntil,
}: Props) {
  const router = useRouter();
  const [notes, setNotes] = useState(currentNotes);
  const [effectiveUntil, setEffectiveUntil] = useState(currentEffectiveUntil);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const body: Record<string, unknown> = { notes: notes || null };
      if (status === "staged" && effectiveUntil) {
        body.effectiveUntil = effectiveUntil;
      } else if (status === "staged" && !effectiveUntil) {
        body.effectiveUntil = null;
      }
      const res = await apiFetch(
        `/api/admin/billing/rate-references/${rateReferenceId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
          issues?: { path: (string | number)[]; message: string }[];
        } | null;
        throw new Error(
          b?.issues?.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") ||
            b?.message ||
            b?.error ||
            `HTTP ${res.status}`,
        );
      }
      setSaveOk(true);
      router.refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRetire() {
    setRetiring(true);
    setRetireError(null);
    try {
      const res = await apiFetch(
        `/api/admin/billing/rate-references/${rateReferenceId}/retire`,
        { method: "POST" },
      );
      if (!res.ok) {
        const b = (await res.json().catch(() => null)) as {
          error?: string;
          message?: string;
        } | null;
        throw new Error(b?.message || b?.error || `HTTP ${res.status}`);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push("/billing/rate-references" as any);
      router.refresh();
    } catch (err) {
      setRetireError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetiring(false);
      setConfirmRetire(false);
    }
  }

  return (
    <>
      {/* Edit panel */}
      <section className="mb-4 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-50">
          Edit{" "}
          <span className="text-xs font-normal text-ink-500">
            {status === "current"
              ? "(notes only — price/dates immutable on active row)"
              : "(notes and end date — row is still staged)"}
          </span>
        </h2>
        <form onSubmit={handleSave} className="space-y-3">
          <label className="block">
            <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
            />
          </label>

          {status === "staged" && (
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-brand text-ink-400">
                Effective until (YYYY-MM-DD, optional)
              </span>
              <input
                type="text"
                value={effectiveUntil}
                onChange={(e) => setEffectiveUntil(e.target.value)}
                placeholder="leave empty for open-ended"
                className="mt-1 w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 font-mono text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
              />
              <span className="mt-0.5 block text-[10px] text-ink-500">
                Staged rows allow end-date changes. Active rows do not.
              </span>
            </label>
          )}

          {saveError && (
            <div className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
              {saveError}
            </div>
          )}
          {saveOk && (
            <div className="rounded border border-emerald-700/40 bg-emerald-950/30 p-2 text-xs text-emerald-200">
              Saved.
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-sv-sky/20 px-4 py-2 text-sm font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </section>

      {/* Retire panel */}
      <section className="rounded-lg border border-rose-700/30 bg-rose-950/10 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-rose-200">
              {status === "current" ? "Retire active rate" : "Remove staged version"}
            </h2>
            <p className="mt-1 text-xs text-rose-300/80">
              {status === "current"
                ? "Sets effectiveUntil = now(). Sessions after this moment will find no active rate for this code's factor — a resolution gap. Stage a replacement version first to avoid the gap."
                : "Sets effectiveUntil = now() on this staged row. It will immediately become expired."}
            </p>
          </div>
          {!confirmRetire ? (
            <button
              onClick={() => setConfirmRetire(true)}
              className="shrink-0 rounded-md bg-rose-900/40 px-3 py-1.5 text-xs font-medium text-rose-200 ring-1 ring-rose-700/40 hover:bg-rose-900/60"
            >
              {status === "current" ? "Retire rate" : "Remove staged"}
            </button>
          ) : (
            <div className="flex shrink-0 gap-2">
              <button
                onClick={handleRetire}
                disabled={retiring}
                className="rounded-md bg-rose-700/60 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-700/80 disabled:opacity-40"
              >
                {retiring ? "Retiring…" : "Confirm retire"}
              </button>
              <button
                onClick={() => setConfirmRetire(false)}
                className="rounded-md bg-bg-base/50 px-3 py-1.5 text-xs text-ink-400 ring-1 ring-bg-border hover:text-ink-100"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
        {retireError && (
          <div className="mt-2 rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
            {retireError}
          </div>
        )}
      </section>
    </>
  );
}
