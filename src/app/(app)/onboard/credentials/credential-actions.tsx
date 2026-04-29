"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

/**
 * Per-row actions on the vendor-credentials list. Two operations:
 *   - Toggle status (active ↔ revoked).
 *   - Delete (after confirm; cascades nothing — installations that
 *     pointed at this credential get credentials_id NULL'd by the
 *     ON DELETE SET NULL FK).
 */
export function CredentialActions({
  credentialId,
  status,
}: {
  credentialId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"toggle" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleStatus() {
    setError(null);
    setBusy("toggle");
    try {
      const next = status === "active" ? "revoked" : "active";
      const res = await apiFetch(`/api/admin/vendor-credentials/${credentialId}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !window.confirm(
        "Delete this saved credential? Installations that referenced it will have their credentials_id cleared but otherwise remain. This cannot be undone.",
      )
    ) {
      return;
    }
    setError(null);
    setBusy("delete");
    try {
      const res = await apiFetch(`/api/admin/vendor-credentials/${credentialId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={toggleStatus}
        disabled={busy !== null}
        title={status === "active" ? "Mark revoked" : "Re-activate"}
        className="rounded border border-bg-border bg-bg-base/40 px-2 py-1 text-[10px] text-ink-300 hover:bg-bg-raised hover:text-ink-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "toggle" ? "…" : status === "active" ? "Revoke" : "Re-activate"}
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={busy !== null}
        className="rounded bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy === "delete" ? "…" : "Delete"}
      </button>
      {error && <span className="ml-2 text-[10px] text-rose-300">{error}</span>}
    </div>
  );
}
