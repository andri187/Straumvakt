"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * Reusable destructive-action button.
 *
 * Renders a small "Delete" button. On click:
 *   1. window.confirm() with the operator-supplied warning text.
 *   2. DELETE to the given API endpoint via apiFetch.
 *   3. On 2xx, push to redirectTo (typically the parent list).
 *
 * Used on /sites/[id], /installations/[id], /circuits/[id],
 * /chargers/[id] for cascade-deletes per the schema's onDelete chain.
 */
export function DeleteButton({
  endpoint,
  redirectTo,
  confirmText,
  label = "Delete",
}: {
  endpoint: string;
  redirectTo: string;
  confirmText: string;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!window.confirm(confirmText)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch(endpoint, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      // typedRoutes makes router.push reject `string`; we accept any
      // path the caller chose, so a hard cast is cleaner than threading
      // typed route generics through props.
      router.push(redirectTo as Parameters<typeof router.push>[0]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 ring-1 ring-rose-500/30 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Deleting…" : label}
      </button>
      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1 text-[10px] text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}
