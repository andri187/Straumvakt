"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";

export function DismissButton({ identityString }: { identityString: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function dismiss() {
    if (!window.confirm(`Dismiss pending discovery for ${identityString}? It will reappear if the charger keeps trying.`)) return;
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/admin/pending-discoveries/${encodeURIComponent(identityString)}`,
        { method: "DELETE" },
      );
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
      onClick={dismiss}
      disabled={busy}
      className="rounded-md bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-300 ring-1 ring-rose-500/20 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? "..." : "Dismiss"}
    </button>
  );
}
