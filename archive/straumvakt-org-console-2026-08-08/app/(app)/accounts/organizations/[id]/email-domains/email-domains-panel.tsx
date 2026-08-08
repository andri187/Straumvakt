"use client";

// Interactive email-domain rules panel — add / edit / delete.
//
// The panel renders:
//   1. A table of existing rules with Edit and Delete per row.
//   2. An inline "Add domain rule" form that appears when the operator
//      clicks the button.
//   3. An inline edit row that expands in place when the operator clicks Edit.
//
// All mutations hit the API directly (no server actions needed here since
// this is a SPA-style client component with optimistic state).

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type { EmailDomainRow } from "./page";

const POLICY_LABELS: Record<string, string> = {
  auto_join:          "Auto-join",
  request_approval:   "Request approval",
  disabled:           "Disabled",
};

const POLICY_COLORS: Record<string, string> = {
  auto_join:          "bg-sv-green/10 text-sv-green",
  request_approval:   "bg-sv-sky/10 text-sv-sky",
  disabled:           "bg-ink-500/10 text-ink-400",
};

type Policy = "auto_join" | "request_approval" | "disabled";

type DriverGroupOption = {
  id: string;
  displayName: string;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function EmailDomainsPanel({
  orgId,
  initialDomains,
  driverGroups,
}: {
  orgId: string;
  initialDomains: EmailDomainRow[];
  driverGroups: DriverGroupOption[];
}) {
  const [domains, setDomains] = useState<EmailDomainRow[]>(initialDomains);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Add form state ────────────────────────────────────────────────
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newPolicy, setNewPolicy] = useState<Policy>("request_approval");
  const [newGroupId, setNewGroupId] = useState("");

  // ── Edit state (row-level) ────────────────────────────────────────
  const [editId, setEditId] = useState<string | null>(null);
  const [editPolicy, setEditPolicy] = useState<Policy>("request_approval");
  const [editGroupId, setEditGroupId] = useState("");

  async function refresh() {
    const res = await apiFetch(`/api/admin/orgs/${orgId}/email-domains`);
    if (res.ok) {
      const body = (await res.json()) as { domains: EmailDomainRow[] };
      setDomains(body.domains);
    }
  }

  // ── Add ─────────────────────────────────────────────────────────────

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        domain: newDomain.trim().toLowerCase(),
        policy: newPolicy,
      };
      if (newPolicy === "auto_join" && newGroupId) {
        body.defaultDriverGroupId = newGroupId;
      }
      const res = await apiFetch(`/api/admin/orgs/${orgId}/email-domains`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const rb = (await res.json().catch(() => ({}))) as { error?: string; issues?: { message: string }[] };
        if (rb.error === "domain_taken") throw new Error("That domain is already claimed by another organisation.");
        if (rb.error === "default_driver_group_required_for_auto_join") {
          throw new Error("Auto-join requires a default driver group.");
        }
        throw new Error(rb.issues?.[0]?.message ?? rb.error ?? `HTTP ${res.status}`);
      }
      setNewDomain("");
      setNewPolicy("request_approval");
      setNewGroupId("");
      setShowAdd(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Edit ─────────────────────────────────────────────────────────────

  function startEdit(row: EmailDomainRow) {
    setEditId(row.id);
    setEditPolicy(row.policy);
    setEditGroupId(row.defaultDriverGroupId ?? "");
    setError(null);
  }

  async function handleSaveEdit(id: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { policy: editPolicy };
      if (editPolicy === "auto_join") {
        if (!editGroupId) throw new Error("Auto-join requires a default driver group.");
        body.defaultDriverGroupId = editGroupId;
      } else {
        body.defaultDriverGroupId = null;
      }
      const res = await apiFetch(`/api/admin/orgs/${orgId}/email-domains/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const rb = (await res.json().catch(() => ({}))) as { error?: string; issues?: { message: string }[] };
        if (rb.error === "default_driver_group_required_for_auto_join") {
          throw new Error("Auto-join requires a default driver group.");
        }
        throw new Error(rb.issues?.[0]?.message ?? rb.error ?? `HTTP ${res.status}`);
      }
      setEditId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────

  async function handleDelete(row: EmailDomainRow) {
    if (busy) return;
    const ok = confirm(`Remove the email-domain rule for "${row.domain}"? This cannot be undone.`);
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/admin/orgs/${orgId}/email-domains/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const rb = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(rb.error ?? `HTTP ${res.status}`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <section>
      {/* Header */}
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
            Email domain rules ({domains.length})
          </h2>
          <p className="mt-0.5 text-[11px] text-ink-500">
            When a driver self-registers with a matching email domain, the policy
            determines whether they are auto-enrolled or placed in the approval
            queue.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setShowAdd(true); setError(null); }}
          className="ml-4 shrink-0 rounded-md border border-sv-sky/40 bg-sv-sky/10 px-3 py-1.5 text-xs font-medium text-sv-sky hover:bg-sv-sky/20"
        >
          + Add rule
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <p className="mb-3 rounded border border-rose-500/40 bg-rose-950/20 p-2 text-[11px] text-rose-200">
          {error}
        </p>
      )}

      {/* Add form */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="mb-4 rounded-md border border-sv-sky/20 bg-bg-surface/50 p-4"
        >
          <h3 className="mb-3 text-xs font-semibold text-ink-50">
            New email domain rule
          </h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_auto]">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-brand text-ink-400">
                Domain
              </label>
              <input
                type="text"
                required
                autoFocus
                placeholder="example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="w-full rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-xs text-ink-100 placeholder-ink-500 focus:border-sv-sky focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-brand text-ink-400">
                Policy
              </label>
              <select
                value={newPolicy}
                onChange={(e) => setNewPolicy(e.target.value as Policy)}
                className="rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
              >
                <option value="request_approval">Request approval</option>
                <option value="auto_join">Auto-join</option>
                <option value="disabled">Disabled</option>
              </select>
            </div>
            {newPolicy === "auto_join" && (
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-brand text-ink-400">
                  Default driver group
                </label>
                <select
                  required
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  className="rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
                >
                  <option value="">— select —</option>
                  {driverGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.displayName}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-md border border-sv-sky/40 bg-sv-sky/10 px-3 py-1.5 text-xs font-medium text-sv-sky hover:bg-sv-sky/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setNewDomain(""); setNewPolicy("request_approval"); setNewGroupId(""); setError(null); }}
                className="rounded border border-bg-border px-2 py-1.5 text-xs text-ink-400 hover:text-ink-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Table */}
      {domains.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No email domain rules configured for this organisation yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-bg-border">
          <table className="w-full text-xs">
            <thead className="border-b border-bg-border bg-bg-surface/40">
              <tr>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-brand text-ink-400">
                  Domain
                </th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-brand text-ink-400">
                  Policy
                </th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-brand text-ink-400">
                  Auto-join group
                </th>
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-brand text-ink-400">
                  Created
                </th>
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-brand text-ink-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/50">
              {domains.map((row) =>
                editId === row.id ? (
                  // ── Edit row ───────────────────────────────────────────────
                  <tr key={row.id} className="bg-bg-raised/40">
                    <td className="px-3 py-2 font-mono text-ink-100">{row.domain}</td>
                    <td className="px-3 py-2">
                      <select
                        value={editPolicy}
                        onChange={(e) => setEditPolicy(e.target.value as Policy)}
                        className="rounded border border-bg-border bg-bg-base/60 px-2 py-1 text-[11px] text-ink-100 focus:border-sv-sky focus:outline-none"
                      >
                        <option value="request_approval">Request approval</option>
                        <option value="auto_join">Auto-join</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {editPolicy === "auto_join" ? (
                        <select
                          required
                          value={editGroupId}
                          onChange={(e) => setEditGroupId(e.target.value)}
                          className="rounded border border-bg-border bg-bg-base/60 px-2 py-1 text-[11px] text-ink-100 focus:border-sv-sky focus:outline-none"
                        >
                          <option value="">— select —</option>
                          {driverGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.displayName}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-500">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleSaveEdit(row.id)}
                          className="rounded border border-sv-sky/40 bg-sv-sky/10 px-2 py-0.5 text-[11px] text-sv-sky hover:bg-sv-sky/20 disabled:opacity-50"
                        >
                          {busy ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditId(null)}
                          className="rounded border border-bg-border px-2 py-0.5 text-[11px] text-ink-400 hover:text-ink-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  // ── Display row ────────────────────────────────────────────
                  <tr key={row.id} className="hover:bg-bg-base/20">
                    <td className="px-3 py-2 font-mono text-ink-100">{row.domain}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "rounded px-1.5 py-0.5 font-mono text-[10px] " +
                          (POLICY_COLORS[row.policy] ?? "bg-ink-500/10 text-ink-400")
                        }
                      >
                        {POLICY_LABELS[row.policy] ?? row.policy}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-300">
                      {row.defaultDriverGroupDisplayName ?? (
                        <span className="text-ink-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink-500">
                      {new Date(row.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => startEdit(row)}
                          className="rounded border border-bg-border px-2 py-0.5 text-[11px] text-ink-300 hover:text-ink-50 disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDelete(row)}
                          className="rounded border border-rose-500/40 bg-rose-500/5 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
