"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";

/**
 * Inline panel on the Zaptec wizard's discover step. Lets the operator
 * persist the credentials they just authenticated with into the
 * VendorCredential vault under one of their orgs. Saved creds power
 * the new /onboard credential-tree view (slice 4) — the operator
 * doesn't have to re-enter the password every time they want to
 * inspect their Zaptec inventory.
 */
export function SaveCredentialsPanel({
  username,
  password,
  installationCount,
}: {
  username: string;
  password: string;
  installationCount: number;
}) {
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [orgId, setOrgId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingOrgs(true);
    apiFetch("/api/admin/orgs")
      .then((r) => r.json())
      .then((d: { orgs?: OrgSummary[] }) => {
        const list = (d.orgs ?? []).filter((o) => o.status !== "archived");
        setOrgs(list);
        setOrgId(list[0]?.id ?? "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingOrgs(false));
  }, []);

  async function onSave() {
    if (!orgId) return;
    setError(null);
    setSaving(true);
    try {
      const res = await apiFetch(`/api/admin/orgs/${orgId}/vendor-credentials`, {
        method: "POST",
        body: JSON.stringify({
          vendorSlug: "zaptec",
          username,
          password,
          notes: notes || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; credential?: { id: string } }
        | null;
      if (!res.ok) {
        if (body?.error === "already_exists") {
          setError(
            "Credentials already saved for this org + Zaptec username. Rotate the password from the credentials list if you need to update.",
          );
        } else if (body?.error === "vendor_not_found") {
          setError("Zaptec vendor row missing in hardware catalogue — ask an admin to seed it.");
        } else {
          setError(body?.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (savedAt) {
    return (
      <div className="rounded-md border border-emerald-700/40 bg-emerald-950/20 p-3 text-xs text-emerald-200">
        ✓ Credentials saved to vault at {savedAt}. Visible under the Onboarding tab for this org.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-sv-sky/30 bg-sv-sky/5 p-3 text-xs">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <p className="font-medium text-sv-sky">Save these credentials</p>
          <p className="mt-0.5 text-ink-400">
            Persists username + (encrypted) password under an org so you can re-discover{" "}
            {installationCount === 1 ? "this installation" : `these ${installationCount} installations`}{" "}
            without re-entering credentials.
          </p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          disabled={loadingOrgs || saving}
          className="rounded-md border border-bg-border bg-bg-inset px-2 py-1.5 text-xs text-ink-50 disabled:opacity-50"
        >
          {loadingOrgs ? (
            <option>Loading orgs…</option>
          ) : orgs.length === 0 ? (
            <option value="">No active orgs available</option>
          ) : (
            orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.displayName} ({o.slug})
              </option>
            ))
          )}
        </select>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          maxLength={500}
          disabled={saving}
          className="rounded-md border border-bg-border bg-bg-inset px-2 py-1.5 text-xs text-ink-50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !orgId}
          className="rounded-md bg-sv-sky/20 px-3 py-1.5 text-xs font-medium text-sv-sky ring-1 ring-sv-sky/30 hover:bg-sv-sky/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save to vault"}
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded border border-rose-700/40 bg-rose-950/30 px-2 py-1 text-[11px] text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}
