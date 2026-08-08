// /billing/driver-contracts — DriverGroupMembership catalogue (Sprint 9 / ADR 0019).
//
// Read-only surface. Shows all drivers assigned to DriverGroups under
// Agreements. Filterable by ?orgId= (DriverGroup.ownerOrgId).
// Tile strip: total members / dormant / members-by-agreement breakdown.
//
// "Dormant" = no session in the past 90 days.
// Drivers are admin-assigned (no self-signup): each row represents an
// admin action that placed a user into a DriverGroup.

import { SectionTabs, OPERATIONS_TABS, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

interface DriverMembershipRow {
  membershipId: string;
  userId: string;
  userDisplayName: string | null;
  userEmail: string;
  userPhone: string | null;
  driverGroupId: string;
  driverGroupName: string;
  agreementId: string;
  agreementDisplayName: string;
  agreementType: string;
  agreementStatus: string;
  addedAt: string;
  lastSessionAt: string | null;
  idTokenCount: number;
  isDormant: boolean;
}

interface TileData {
  totalActiveMembers: number;
  dormantMembers: number;
  membersByAgreement: Array<{ agreementDisplayName: string; count: number }>;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Driver contracts" };

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("is-IS", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default async function DriverContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const params = await searchParams;
  const orgId = params.orgId;

  const url = orgId
    ? `/api/admin/billing/driver-contracts?orgId=${encodeURIComponent(orgId)}`
    : "/api/admin/billing/driver-contracts";

  const { memberships, tiles } = await apiFetchServerJson<{
    memberships: DriverMembershipRow[];
    tiles: TileData;
  }>(url);

  // Group by agreement for display.
  const byAgreement = new Map<string, DriverMembershipRow[]>();
  for (const m of memberships) {
    const key = m.agreementDisplayName;
    const arr = byAgreement.get(key) ?? [];
    arr.push(m);
    byAgreement.set(key, arr);
  }
  const agreements = Array.from(byAgreement.keys()).sort();

  const dormantPct =
    tiles.totalActiveMembers > 0
      ? Math.round((tiles.dormantMembers / tiles.totalActiveMembers) * 100)
      : 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Driver contracts"
        description="Drivers assigned to DriverGroups under Agreements (ADR 0019). Each row is an admin-assigned membership — drivers do not self-enroll. Dormant = no session in the past 90 days."
      />

      {/* Tile strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Total members" value={String(tiles.totalActiveMembers)} />
        <Tile
          label={`Dormant (${dormantPct}%)`}
          value={String(tiles.dormantMembers)}
          tone={tiles.dormantMembers > 0 ? "amber" : undefined}
        />
        <Tile label="Agreements" value={String(tiles.membersByAgreement.length)} />
      </div>

      {/* Per-agreement breakdown (compact strip) */}
      {tiles.membersByAgreement.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {tiles.membersByAgreement.map((item) => (
            <span
              key={item.agreementDisplayName}
              className="rounded border border-bg-border bg-bg-inset/40 px-2 py-1 text-[10px] text-ink-400"
            >
              {item.agreementDisplayName}
              <span className="ml-1 font-semibold text-ink-200">{item.count}</span>
            </span>
          ))}
        </div>
      )}

      {agreements.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No driver memberships yet. Assign drivers to a DriverGroup via the
          agreements seed scripts or the agreement management UI (pending).
        </div>
      ) : (
        agreements.map((agrName) => {
          const rows = byAgreement.get(agrName) ?? [];
          const dormantInGroup = rows.filter((r) => r.isDormant).length;
          return (
            <section key={agrName} className="mb-6">
              <h2 className="mb-2 flex items-baseline gap-3 text-sm font-semibold uppercase tracking-brand text-ink-300">
                <span>{agrName} ({rows.length})</span>
                {dormantInGroup > 0 && (
                  <span className="rounded border border-amber-700/40 bg-amber-950/20 px-1.5 py-0.5 text-[9px] normal-case text-amber-300">
                    {dormantInGroup} dormant
                  </span>
                )}
              </h2>
              <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
                <table className="w-full text-xs">
                  <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                    <tr className="text-left">
                      <th className="px-3 py-2">Driver</th>
                      <th className="px-3 py-2">Contact</th>
                      <th className="px-3 py-2">Group</th>
                      <th className="px-3 py-2">Agreement type</th>
                      <th className="px-3 py-2 text-right">Tokens</th>
                      <th className="px-3 py-2">Added</th>
                      <th className="px-3 py-2">Last session</th>
                      <th className="px-3 py-2">Flags</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-border/40">
                    {rows.map((m) => (
                      <tr
                        key={m.membershipId}
                        className={
                          "hover:bg-bg-base/20 " +
                          (m.isDormant ? "bg-amber-950/5" : "")
                        }
                      >
                        <td className="px-3 py-1.5 text-ink-100 font-medium">
                          {m.userDisplayName ?? (
                            <span className="text-ink-500 italic">unnamed</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-ink-400">
                          <span className="block">{m.userEmail}</span>
                          {m.userPhone && (
                            <span className="block text-ink-600">{m.userPhone}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-ink-300">
                          {m.driverGroupName}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                          {m.agreementType.replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-1.5 text-right text-ink-300">
                          {m.idTokenCount}
                        </td>
                        <td className="px-3 py-1.5 text-ink-400">
                          {fmtDate(m.addedAt)}
                        </td>
                        <td className="px-3 py-1.5 text-ink-400">
                          {m.lastSessionAt ? (
                            fmtDate(m.lastSessionAt)
                          ) : (
                            <span className="text-ink-600">never</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {m.isDormant && (
                            <span className="rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-0.5 text-[9px] uppercase tracking-brand text-amber-300">
                              dormant
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber";
}) {
  const accent =
    tone === "amber"
      ? "border-amber-700/40 bg-amber-950/20"
      : "border-bg-border bg-bg-base/30";
  return (
    <div className={`rounded-lg border p-4 ${accent}`}>
      <p className="text-[10px] uppercase tracking-brand text-ink-500">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-semibold " +
          (tone === "amber" ? "text-amber-200" : "text-ink-50")
        }
      >
        {value}
      </p>
    </div>
  );
}
