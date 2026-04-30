"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * Bulk-clear pending rows whose last attempt is older than 5 min
 * (the same "live" window the row's status emblem uses). Idle rows
 * are connection probes that never came back — usually safe to nuke.
 * If the charger reconnects later, the gateway's no-auth hook
 * re-creates the row at the next retry.
 */
export function ClearIdleButton({ idleCount }: { idleCount: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function clear() {
    if (idleCount === 0) return;
    if (
      !window.confirm(
        `Clear ${idleCount} idle pending charger${idleCount === 1 ? "" : "s"}? Live (still-retrying) rows will be kept.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch("/api/admin/pending-discoveries/clear-idle", {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={clear}
      disabled={busy || idleCount === 0}
      className="rounded-md border border-bg-border bg-bg-base/50 px-3 py-1.5 text-xs font-medium text-ink-200 hover:bg-bg-base/70 hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
      title={
        idleCount === 0
          ? "No idle rows — every pending charger is still actively retrying."
          : `Bulk-deletes the ${idleCount} pending row${idleCount === 1 ? "" : "s"} not seen in the last 5 min.`
      }
    >
      {busy ? "Clearing…" : `Clear idle (${idleCount})`}
    </button>
  );
}
