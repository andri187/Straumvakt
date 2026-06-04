"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import type {
  BillObjectSummary,
  BillObjectMemberSummary,
  BillObjectKind,
} from "@straumvakt/shared/domain/bill-objects";
import type { UserSummary } from "@straumvakt/shared/domain/users";

/**
 * ADR 0029 — Billing-homes (BillObject) panel for the host-detail page.
 *
 * Lists a host's BillObjects (apartments / units / stalls for a
 * multi-dwelling host; companies / departments / cost-centers for a
 * company host), lets the operator expand one to view its active member
 * drivers, and assign a driver via
 * POST /api/admin/orgs/:orgId/bill-objects/:id/members.
 *
 * ADR 0029 §5: a driver has at most one ACTIVE billing-home per host —
 * assigning closes any prior active membership for that driver under this
 * org. The API reports closedPrevious; we surface it so the operator knows
 * a move happened rather than a fresh attach.
 *
 * Read data (bill objects + the candidate driver list) is fetched
 * server-side and passed in; writes + member refresh happen client-side.
 */

const KIND_LABEL: Record<BillObjectKind, string> = {
  apartment: "Apartment",
  unit: "Unit",
  stall: "Stall",
  company: "Company",
  department: "Department",
  cost_center: "Cost center",
  other: "Other",
};

function ownerLabel(
  owner: BillObjectSummary["owner"],
  usersById: Map<string, UserSummary>,
): { text: string; sub: string | null } {
  if (owner.kind === "user") {
    const u = usersById.get(owner.userId);
    return {
      text: u ? (u.displayName ?? u.email) : owner.userId.slice(0, 8),
      sub: "driver-owner",
    };
  }
  if (owner.kind === "org") {
    return { text: "Org-owned", sub: "org-owner" };
  }
  return { text: "—", sub: null };
}

export function BillObjectsPanel({
  orgId,
  initialBillObjects,
  driverCandidates,
}: {
  orgId: string;
  initialBillObjects: BillObjectSummary[];
  driverCandidates: UserSummary[];
}) {
  const usersById = new Map(driverCandidates.map((u) => [u.id, u]));

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          Billing-homes ({initialBillObjects.length})
        </h2>
        <span className="text-[11px] text-ink-500">ADR 0029 · BillObject</span>
      </div>

      <p className="mb-3 text-[11px] text-ink-500">
        A billing-home is the unit that accumulates charging cost and resolves
        to an owner of record (the invoice recipient). Drivers attach to exactly
        one active billing-home per host.
      </p>

      {initialBillObjects.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No billing-homes for this host yet.
        </div>
      ) : (
        <div className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {initialBillObjects.map((bo) => (
            <BillObjectRow
              key={bo.id}
              orgId={orgId}
              billObject={bo}
              owner={ownerLabel(bo.owner, usersById)}
              driverCandidates={driverCandidates}
              usersById={usersById}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BillObjectRow({
  orgId,
  billObject,
  owner,
  driverCandidates,
  usersById,
}: {
  orgId: string;
  billObject: BillObjectSummary;
  owner: { text: string; sub: string | null };
  driverCandidates: UserSummary[];
  usersById: Map<string, UserSummary>;
}) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<BillObjectMemberSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadMembers() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/admin/orgs/${orgId}/bill-objects/${billObject.id}/members`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { members: BillObjectMemberSummary[] };
      setMembers(body.members);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && members === null && !loading) {
      void loadMembers();
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !selectedUserId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch(
        `/api/admin/orgs/${orgId}/bill-objects/${billObject.id}/members`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: selectedUserId }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        created?: boolean;
        closedPrevious?: number;
      };
      if (!res.ok) {
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
      }
      const who =
        usersById.get(selectedUserId)?.displayName ??
        usersById.get(selectedUserId)?.email ??
        selectedUserId.slice(0, 8);
      if (body.created === false) {
        setNotice(`${who} is already an active member of this billing-home.`);
      } else if (body.closedPrevious && body.closedPrevious > 0) {
        setNotice(
          `Assigned ${who}. Their prior active billing-home in this host was closed.`,
        );
      } else {
        setNotice(`Assigned ${who}.`);
      }
      setSelectedUserId("");
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Candidates not already shown as active members (best-effort — members
  // may not be loaded yet, in which case we show the full list).
  const activeMemberIds = new Set(
    (members ?? []).filter((m) => m.effectiveTo === null).map((m) => m.userId),
  );
  const assignable = driverCandidates.filter((u) => !activeMemberIds.has(u.id));

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-bg-base/20"
      >
        <span
          className={
            "text-ink-500 transition-transform " + (open ? "rotate-90" : "")
          }
        >
          ▸
        </span>
        <span className="text-sm font-medium text-ink-50">{billObject.label}</span>
        <span className="rounded bg-ink-800/60 px-1.5 py-0.5 text-[10px] uppercase text-ink-300">
          {KIND_LABEL[billObject.kind]}
        </span>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-400">
          <span>{owner.text}</span>
          {owner.sub && (
            <span className="rounded bg-bg-base/50 px-1.5 py-0.5 text-[10px] text-ink-500">
              {owner.sub}
            </span>
          )}
          <StatusDot status={billObject.status} />
        </span>
      </button>

      {open && (
        <div className="border-t border-bg-border/40 bg-bg-base/20 px-6 py-3">
          {error && (
            <p className="mb-2 rounded border border-rose-500/40 bg-rose-950/20 p-2 text-[11px] text-rose-200">
              {error}
            </p>
          )}
          {notice && (
            <p className="mb-2 rounded border border-sv-sky/40 bg-sv-sky/10 p-2 text-[11px] text-sv-sky">
              {notice}
            </p>
          )}

          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-brand text-ink-500">
            Active drivers
          </h4>
          {loading ? (
            <p className="text-[11px] text-ink-500">Loading members…</p>
          ) : members === null ? (
            <p className="text-[11px] text-ink-500">—</p>
          ) : members.filter((m) => m.effectiveTo === null).length === 0 ? (
            <p className="text-[11px] text-ink-500">
              No drivers attached to this billing-home.
            </p>
          ) : (
            <ul className="mb-3 divide-y divide-bg-border/40 rounded border border-bg-border bg-bg-base/40">
              {members
                .filter((m) => m.effectiveTo === null)
                .map((m) => {
                  const u = usersById.get(m.userId);
                  return (
                    <li
                      key={m.id}
                      className="flex items-center gap-3 px-3 py-1.5 text-xs"
                    >
                      <span className="font-medium text-ink-100">
                        {u ? (u.displayName ?? u.email) : m.userId.slice(0, 8)}
                      </span>
                      {u?.displayName && (
                        <span className="text-[10px] text-ink-500">{u.email}</span>
                      )}
                      <span className="ml-auto text-[10px] text-ink-500">
                        since {new Date(m.effectiveFrom).toLocaleDateString()}
                      </span>
                    </li>
                  );
                })}
            </ul>
          )}

          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-brand text-ink-500">
            Assign a driver
          </h4>
          <form onSubmit={handleAssign} className="flex flex-wrap items-center gap-2">
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="min-w-56 rounded border border-bg-border bg-bg-base/60 px-2 py-1.5 text-xs text-ink-100 focus:border-sv-sky focus:outline-none"
            >
              <option value="">Select a driver…</option>
              {assignable.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.displayName ?? u.email) +
                    (u.displayName ? ` · ${u.email}` : "")}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busy || !selectedUserId}
              className="rounded-md border border-sv-green/40 bg-sv-green/10 px-3 py-1.5 text-xs font-medium text-sv-green hover:bg-sv-green/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Assigning…" : "Assign"}
            </button>
          </form>
          {driverCandidates.length === 0 && (
            <p className="mt-2 text-[10px] text-ink-500">
              No active drivers available to assign. Create drivers in People →
              Users (audience = driver) first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] " +
        (active
          ? "bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-700/30"
          : "bg-bg-base/50 text-ink-400 ring-1 ring-bg-border")
      }
    >
      <span
        className={
          "h-1.5 w-1.5 rounded-full " + (active ? "bg-emerald-400" : "bg-ink-500")
        }
      />
      {status}
    </span>
  );
}
