"use client";

// Inline deactivate / reactivate toggle for a billing.cost_factors row.
//
// Rule 5 guard:
//   • Deactivating a factor referenced by active TariffDefinitions is allowed
//     but warned. The warning is surfaced in a confirm dialog before the
//     request fires. The API's response includes activeTariffCount which we
//     surface post-fact if the confirm was already accepted.
//
// Sprint 9 — Track A.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

interface StatusToggleProps {
  factorId: string;
  currentStatus: string;
  tariffCount: number;
}

export function StatusToggle({
  factorId,
  currentStatus,
  tariffCount,
}: StatusToggleProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = currentStatus === "active";
  const isArchived = currentStatus === "archived";

  async function handleToggle() {
    setError(null);

    if (isActive) {
      // Show confirmation with tariff-count warning before deactivating.
      const warningText =
        tariffCount > 0
          ? `This factor is referenced by ${tariffCount} tariff${tariffCount !== 1 ? "s" : ""}. Deactivating will not break existing tariffs but the factor cannot be assigned to new tariffs while inactive.\n\nDeactivate anyway?`
          : "Deactivate this cost factor?";

      if (!window.confirm(warningText)) return;

      setBusy(true);
      try {
        const res = await apiFetch(
          `/api/admin/billing/cost-factors/${factorId}/deactivate`,
          { method: "POST" },
        );
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as {
            error?: string;
            message?: string;
          } | null;
          throw new Error(b?.message ?? b?.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    } else if (isArchived) {
      if (!window.confirm("Reactivate this cost factor?")) return;

      setBusy(true);
      try {
        const res = await apiFetch(
          `/api/admin/billing/cost-factors/${factorId}/reactivate`,
          { method: "POST" },
        );
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as {
            error?: string;
            message?: string;
          } | null;
          throw new Error(b?.message ?? b?.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    }
  }

  // Draft status — no inline toggle (use the edit page for promotion).
  if (currentStatus === "draft") {
    return null;
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={busy}
        onClick={handleToggle}
        className={
          "rounded px-1.5 py-0.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
          (isActive
            ? "text-amber-400 hover:bg-amber-950/30 hover:text-amber-200"
            : "text-emerald-400 hover:bg-emerald-950/30 hover:text-emerald-200")
        }
      >
        {busy ? "…" : isActive ? "Deactivate" : "Reactivate"}
      </button>
      {error && (
        <span className="max-w-[160px] text-right text-[9px] text-rose-400">
          {error}
        </span>
      )}
    </span>
  );
}
