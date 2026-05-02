"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";

/**
 * Per-row actions on the vendor-credentials list:
 *   - Manage (link out to the per-credential charger management tree).
 *   - Move… (reassign the credential's owner_org_id to a different org).
 *   - Toggle status (active ↔ revoked).
 *   - Delete (cascade-NULLs the installations that pointed at it).
 */
export function CredentialActions({
  credentialId,
  ownerOrgId,
  status,
  orgs,
}: {
  credentialId: string;
  ownerOrgId: string;
  status: string;
  orgs: OrgSummary[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"toggle" | "delete" | "move" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [targetOrgId, setTargetOrgId] = useState("");

  const moveCandidates = orgs.filter(
    (o) => o.id !== ownerOrgId && o.status === "active",
  );

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

  async function move() {
    if (!targetOrgId) return;
    setError(null);
    setBusy("move");
    try {
      const res = await apiFetch(
        `/api/admin/vendor-credentials/${credentialId}/move`,
        {
          method: "POST",
          body: JSON.stringify({ targetOrgId }),
        },
      );
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        setError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setMoveOpen(false);
      setTargetOrgId("");
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
    <div className="space-y-1 text-right">
      <div className="inline-flex items-center gap-1">
        <Link
          href={`/onboard/credentials/${credentialId}/manage` as Parameters<typeof Link>[0]["href"]}
          className="rounded border border-sv-sky/40 bg-sv-sky/10 px-2 py-1 text-[10px] text-sv-sky hover:bg-sv-sky/20"
          title="Manage which Zaptec chargers this credential controls"
        >
          Manage
        </Link>
        <button
          type="button"
          onClick={() => setMoveOpen((v) => !v)}
          disabled={busy !== null || moveCandidates.length === 0}
          title={
            moveCandidates.length === 0
              ? "No other active organizations"
              : "Reassign this credential to a different organization"
          }
          className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Move…
        </button>
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
      </div>

      {moveOpen && (
        <div className="mt-1 inline-flex items-center gap-1 rounded border border-amber-700/30 bg-amber-950/20 p-1 text-left">
          <select
            value={targetOrgId}
            onChange={(e) => setTargetOrgId(e.target.value)}
            className="rounded border border-bg-border bg-bg-base/60 px-1.5 py-0.5 text-[10px] text-ink-50 focus:border-sv-sky focus:outline-none"
          >
            <option value="">— target org —</option>
            {moveCandidates.map((o) => (
              <option key={o.id} value={o.id}>
                {o.kennitala
                  ? `${o.displayName} · ${o.kennitala}`
                  : o.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={move}
            disabled={busy !== null || !targetOrgId}
            className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-200 ring-1 ring-amber-500/40 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy === "move" ? "…" : "Move"}
          </button>
          <button
            type="button"
            onClick={() => {
              setMoveOpen(false);
              setTargetOrgId("");
            }}
            disabled={busy !== null}
            className="rounded border border-bg-border px-2 py-0.5 text-[10px] text-ink-300 hover:bg-bg-base/50"
          >
            ✕
          </button>
        </div>
      )}

      {error && <div className="text-[10px] text-rose-300">{error}</div>}
    </div>
  );
}
