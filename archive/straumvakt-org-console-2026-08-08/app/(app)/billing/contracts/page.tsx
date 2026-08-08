// /billing/contracts — Agreement catalogue (Sprint 9 / ADR 0019).
//
// Read-only surface. Shows every Agreement grouped by counterparty org,
// with DriverGroup names, cost-factor clause codes, member count, and
// effective dates. Tile strip: total / active / counterparties / members.
//
// Replaces the legacy billing.contracts stub (Sprint 8.13) which pointed
// at the old bilateral Contract model. This page uses the agreements schema
// (ADR 0019 five-type model: service_cpo / service_contractor /
// service_workplace / installation / workplace).

import { SectionTabs, OPERATIONS_TABS, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

interface AgreementRow {
  id: string;
  agreementType: string;
  displayName: string;
  status: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  counterpartyOrgId: string;
  counterpartyOrgName: string;
  cpoOrgId: string | null;
  cpoOrgName: string | null;
  installationId: string | null;
  installationDisplayName: string | null;
  driverGroupNames: string[];
  clauseFactorCodes: string[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

interface TileData {
  totalAgreements: number;
  activeAgreements: number;
  totalCounterparties: number;
  totalDriversCovered: number;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Contracts" };

/** Format an ISO date string as a short human-readable date (Icelandic locale). */
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

export default async function ContractsPage() {
  const { agreements, tiles } = await apiFetchServerJson<{
    agreements: AgreementRow[];
    tiles: TileData;
  }>("/api/admin/billing/contracts");

  // Group by counterparty org name.
  const byCounterparty = new Map<string, AgreementRow[]>();
  for (const a of agreements) {
    const arr = byCounterparty.get(a.counterpartyOrgName) ?? [];
    arr.push(a);
    byCounterparty.set(a.counterpartyOrgName, arr);
  }
  const counterparties = Array.from(byCounterparty.keys()).sort();

  const noActiveFlag =
    tiles.activeAgreements === 0 && tiles.totalAgreements > 0;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Contracts"
        description="Agreement catalogue (ADR 0019). Each row is a legal agreement between Straumvakt and a counterparty org, carrying driver groups, cost-factor clauses, and effective dates. Editing is via seed scripts until the agreement-management UI lands."
      />

      {/* Tile strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Agreements total" value={String(tiles.totalAgreements)} />
        <Tile
          label="Active"
          value={String(tiles.activeAgreements)}
          tone={noActiveFlag ? "amber" : undefined}
        />
        <Tile label="Counterparties" value={String(tiles.totalCounterparties)} />
        <Tile label="Drivers covered" value={String(tiles.totalDriversCovered)} />
      </div>

      {counterparties.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No agreements yet. Seed via apps/api/scripts/ or the agreements resolver.
        </div>
      ) : (
        counterparties.map((cpName) => {
          const rows = byCounterparty.get(cpName) ?? [];
          return (
            <section key={cpName} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
                {cpName} ({rows.length})
              </h2>
              <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
                <table className="w-full text-xs">
                  <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                    <tr className="text-left">
                      <th className="px-3 py-2">Agreement</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Driver groups</th>
                      <th className="px-3 py-2">Clauses</th>
                      <th className="px-3 py-2 text-right">Members</th>
                      <th className="px-3 py-2">Effective from</th>
                      <th className="px-3 py-2">Until</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-border/40">
                    {rows.map((a) => (
                      <tr key={a.id} className="hover:bg-bg-base/20">
                        <td className="px-3 py-1.5 text-ink-100 font-medium">
                          {a.displayName}
                          {a.cpoOrgName && (
                            <span className="ml-2 text-[9px] text-ink-500">
                              via {a.cpoOrgName}
                            </span>
                          )}
                          {a.installationDisplayName && (
                            <span className="ml-2 text-[9px] text-ink-500">
                              @ {a.installationDisplayName}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                          {a.agreementType.replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-1.5 text-ink-300">
                          {a.driverGroupNames.length === 0 ? (
                            <span className="text-ink-600">—</span>
                          ) : (
                            <span>{a.driverGroupNames.join(", ")}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                          {a.clauseFactorCodes.length === 0 ? (
                            <span className="text-ink-600">—</span>
                          ) : (
                            a.clauseFactorCodes.join(" · ")
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right text-ink-200">
                          {a.memberCount}
                        </td>
                        <td className="px-3 py-1.5 text-ink-400">
                          {fmtDate(a.effectiveFrom)}
                        </td>
                        <td className="px-3 py-1.5 text-ink-400">
                          {a.effectiveUntil ? (
                            fmtDate(a.effectiveUntil)
                          ) : (
                            <span className="text-ink-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <StatusBadge status={a.status} />
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

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
      : status === "draft"
        ? "border-sv-sky/30 bg-sv-sky/10 text-sv-sky"
        : status === "expired"
          ? "border-bg-border bg-bg-base/40 text-ink-500"
          : "border-bg-border bg-bg-base/40 text-ink-400";
  return (
    <span
      className={
        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-brand " + tone
      }
    >
      {status}
    </span>
  );
}
