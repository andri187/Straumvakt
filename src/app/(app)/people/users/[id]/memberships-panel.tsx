"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MEMBERSHIP_ROLES } from "@/lib/repositories/_inputs/memberships";
import type { UserMembershipSummary } from "@/lib/repositories/users";

const ROLE_TONE: Record<string, string> = {
  owner: "bg-violet-950/40 text-violet-300 border-violet-700/40",
  admin: "bg-rose-950/40 text-rose-300 border-rose-700/40",
  operator: "bg-sky-950/40 text-sky-300 border-sky-700/40",
  helper: "bg-amber-950/40 text-amber-300 border-amber-700/40",
  contractor: "bg-orange-950/40 text-orange-300 border-orange-700/40",
  driver: "bg-emerald-950/40 text-emerald-300 border-emerald-700/40",
  viewer: "bg-slate-800/60 text-slate-300 border-slate-700/40",
};

export function MembershipsPanel({
  userId,
  memberships,
  availableOrgs,
}: {
  userId: string;
  memberships: UserMembershipSummary[];
  availableOrgs: { id: string; slug: string; displayName: string }[];
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // add-form state
  const [addOrgId, setAddOrgId] = useState(availableOrgs[0]?.id ?? "");
  const [addRole, setAddRole] = useState<(typeof MEMBERSHIP_ROLES)[number]>("operator");

  async function changeRole(orgId: string, role: string) {
    setError(null);
    setBusyKey(`${orgId}:role`);
    try {
      const res = await fetch(
        `/api/admin/memberships/${orgId}/${userId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function removeRow(orgId: string) {
    if (!window.confirm("Remove this membership? Audit row preserved.")) return;
    setError(null);
    setBusyKey(`${orgId}:remove`);
    try {
      const res = await fetch(
        `/api/admin/memberships/${orgId}/${userId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function addMembership(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!addOrgId) return;
    setError(null);
    setBusyKey("add");
    try {
      const res = await fetch(`/api/admin/orgs/${addOrgId}/memberships`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role: addRole }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setAddRole("operator");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="divide-y divide-bg-border/40">
      {memberships.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-300">
          No memberships yet. Add one below.
        </p>
      ) : (
        memberships.map((m) => (
          <div
            key={m.orgId}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
          >
            <div className="min-w-0">
              <Link
                href={`/tenants/organizations/${m.orgId}`}
                className="text-sm font-medium text-ink-50 hover:text-sv-sky"
              >
                {m.orgDisplayName}
              </Link>
              <p className="font-mono text-[11px] text-ink-500">{m.orgSlug}</p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={
                  "inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase " +
                  (ROLE_TONE[m.role] ?? ROLE_TONE.viewer)
                }
              >
                {m.role}
              </span>
              <select
                disabled={busyKey?.startsWith(`${m.orgId}:`)}
                value={m.role}
                onChange={(e) => changeRole(m.orgId, e.target.value)}
                className="rounded-md border border-bg-border bg-bg-base/50 px-2 py-1 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
              >
                {MEMBERSHIP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeRow(m.orgId)}
                disabled={busyKey?.startsWith(`${m.orgId}:`)}
                className="rounded-md bg-rose-500/10 px-2 py-1 text-[11px] font-medium text-rose-300 ring-1 ring-rose-500/20 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          </div>
        ))
      )}

      <form
        onSubmit={addMembership}
        className="flex flex-wrap items-end gap-2 bg-bg-base/40 px-5 py-4"
      >
        {availableOrgs.length === 0 ? (
          <p className="text-xs text-ink-400">
            User is a member of every active org. Create another org to add
            more memberships.
          </p>
        ) : (
          <>
            <label className="block">
              <span className="block text-[10px] font-semibold uppercase tracking-brand text-ink-400">
                Add to org
              </span>
              <select
                value={addOrgId}
                onChange={(e) => setAddOrgId(e.target.value)}
                className="mt-1 rounded-md border border-bg-border bg-bg-base/50 px-2 py-1 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
              >
                {availableOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10px] font-semibold uppercase tracking-brand text-ink-400">
                Role
              </span>
              <select
                value={addRole}
                onChange={(e) =>
                  setAddRole(e.target.value as (typeof MEMBERSHIP_ROLES)[number])
                }
                className="mt-1 rounded-md border border-bg-border bg-bg-base/50 px-2 py-1 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
              >
                {MEMBERSHIP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busyKey === "add" || !addOrgId}
              className="rounded-md bg-sv-green/20 px-3 py-1.5 text-xs font-medium text-sv-green ring-1 ring-sv-green/30 transition-colors hover:bg-sv-green/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyKey === "add" ? "Adding…" : "Add membership"}
            </button>
          </>
        )}
      </form>

      {error && (
        <div className="bg-rose-950/30 px-5 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
}
