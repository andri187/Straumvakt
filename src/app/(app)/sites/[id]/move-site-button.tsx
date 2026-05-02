"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-client";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";

/**
 * Move-site action. Picks a target org from the dropdown (excludes
 * the current org + archived orgs), submits POST /api/admin/sites/:id/move.
 *
 * Cascade is handled server-side. Auto-creates a mirror property in
 * the target org. Tariff anchors and vendor-credential references
 * are NULL'd because they belong to the source org's catalogue.
 */
export function MoveSiteButton({
  siteId,
  siteDisplayName,
  currentOrgId,
  currentOrgDisplayName,
  orgs,
}: {
  siteId: string;
  siteDisplayName: string;
  currentOrgId: string;
  currentOrgDisplayName: string;
  orgs: OrgSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetOrgId, setTargetOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = orgs.filter(
    (o) => o.id !== currentOrgId && o.status === "active",
  );
  const targetOrg = candidates.find((o) => o.id === targetOrgId);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/sites/${siteId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetOrgId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      // Site lives under the new org now — refresh.
      router.refresh();
      setOpen(false);
      setTargetOrgId("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300 ring-1 ring-amber-500/30 hover:bg-amber-500/20"
      >
        Move to another organization…
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded border border-amber-700/30 bg-amber-950/20 p-3">
      <p className="text-xs text-amber-200">
        Move <span className="font-mono">{siteDisplayName}</span> from{" "}
        <span className="font-mono">{currentOrgDisplayName}</span> to another
        organization. Everything under this site (installations, circuits,
        chargers, sessions, history) follows. Tariff anchors and vendor-
        credential links are cleared — re-link them in the new org.
      </p>

      {candidates.length === 0 ? (
        <p className="text-[11px] italic text-ink-400">
          No other active organizations available. Create one first at{" "}
          <a
            href="/accounts/organizations/new"
            className="text-sv-sky hover:underline"
          >
            Accounts → New
          </a>
          .
        </p>
      ) : (
        <select
          value={targetOrgId}
          onChange={(e) => setTargetOrgId(e.target.value)}
          className="w-full rounded-md border border-bg-border bg-bg-base/50 px-3 py-2 text-sm text-ink-50 focus:border-sv-sky focus:outline-none"
        >
          <option value="">— pick target organization —</option>
          {candidates.map((o) => (
            <option key={o.id} value={o.id}>
              {o.kennitala
                ? `${o.displayName} · ${o.kennitala}`
                : o.displayName}
            </option>
          ))}
        </select>
      )}

      {error && (
        <p className="rounded border border-rose-700/40 bg-rose-950/30 p-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !targetOrg}
          className="rounded-md bg-amber-500/20 px-3 py-2 text-xs font-medium text-amber-200 ring-1 ring-amber-500/30 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? "Moving…"
            : targetOrg
              ? `Move to ${targetOrg.displayName}`
              : "Pick a target org"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTargetOrgId("");
            setError(null);
          }}
          disabled={busy}
          className="rounded border border-bg-border px-3 py-2 text-xs text-ink-300 hover:bg-bg-base/50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
