import Link from "next/link";
import { apiFetchServer } from "@/lib/api-client-server";
import type { ContractSummary } from "@straumvakt/shared/domain/contracts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organization · Contracts" };

/**
 * Contracts tab. Shows third-party billing contracts (billing.contracts) —
 * dormant scaffolding today; populated when a separate organization
 * (HOA, property manager, fleet customer) is responsible for paying
 * for sessions at this org's sites. The actual rate that drives
 * session cost lives on Site.dsoTariffId + Installation.retailerTariffId
 * — surfaced on the Tariff chain tab.
 */
export default async function OrgContractsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const res = await apiFetchServer(`/api/admin/orgs/${id}/contracts`);
  const { contracts } = res.ok
    ? ((await res.json()) as { contracts: ContractSummary[] })
    : { contracts: [] };

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          Contracts ({contracts.length})
        </h2>
        <Link
          href={"/billing/contracts/new" as Parameters<typeof Link>[0]["href"]}
          className="rounded border border-bg-border px-3 py-1 text-xs text-ink-300 hover:bg-bg-base/40 hover:text-ink-100"
        >
          + Add contract
        </Link>
      </div>

      <p className="mb-3 text-[11px] text-ink-500">
        Bilateral billing contracts where this organization is on
        either side (owner or counterparty). The rate that drives
        session cost is on the{" "}
        <Link
          href={`/accounts/organizations/${id}/tariff-chain` as Parameters<typeof Link>[0]["href"]}
          className="text-sv-sky hover:underline"
        >
          Tariff chain tab
        </Link>
        . Driver-level contracts surface in the Driver groups view.
      </p>

      {contracts.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-400">
          <p className="mb-2">No contracts for this organization.</p>
          <p className="text-[11px] text-ink-500">
            That&apos;s the correct state when this org operates its own
            sites directly — pricing is driven by the bound DSO + retailer
            tariffs, not by a contract row. Add one here only when a
            separate organization (HOA, property manager, fleet customer)
            is responsible for paying for sessions at this org&apos;s sites.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-xs">
            <thead className="bg-bg-base/50 text-[10px] uppercase tracking-brand text-ink-500">
              <tr>
                <th className="px-3 py-2 text-left font-mono">UID</th>
                <th className="px-3 py-2 text-left">Contract</th>
                <th className="px-3 py-2 text-left">Counterparty</th>
                <th className="px-3 py-2 text-left">Scope</th>
                <th className="px-3 py-2 text-left">Valid from</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Manage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border/40">
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-bg-base/20">
                  <td className="px-3 py-1.5 font-mono text-[10px] text-ink-500">
                    {c.id.slice(0, 8)}…
                  </td>
                  <td className="px-3 py-1.5 text-sm font-medium text-ink-50">
                    {c.displayName}
                    {c.orgId !== id && (
                      <span className="ml-2 rounded bg-sv-sky/10 px-1 py-0.5 text-[9px] uppercase tracking-brand text-sv-sky">
                        as counterparty
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-ink-300">
                    {c.orgId === id ? (
                      c.counterpartyOrgId ? (
                        <Link
                          href={
                            `/accounts/organizations/${c.counterpartyOrgId}` as Parameters<typeof Link>[0]["href"]
                          }
                          className="hover:text-sv-sky"
                        >
                          {c.counterpartyOrgDisplayName ?? "—"}
                        </Link>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )
                    ) : (
                      <Link
                        href={
                          `/accounts/organizations/${c.orgId}` as Parameters<typeof Link>[0]["href"]
                        }
                        className="hover:text-sv-sky"
                      >
                        {c.orgDisplayName}
                      </Link>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-ink-300">
                    <span className="font-mono text-[10px] text-ink-500">
                      {c.scopeType}
                    </span>
                    {c.scopeDisplayName && (
                      <span className="ml-2">{c.scopeDisplayName}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-ink-300">
                    {new Date(c.validFrom).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-1.5">
                    {c.validUntil ? (
                      <span className="text-ink-300">
                        {new Date(c.validUntil).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="rounded bg-sv-sky/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-sv-sky">
                        no expiry
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={
                        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase " +
                        (c.status === "active"
                          ? "bg-emerald-950/40 text-emerald-300"
                          : c.status === "archived"
                            ? "bg-rose-950/40 text-rose-300"
                            : "bg-amber-950/40 text-amber-300")
                      }
                    >
                      {c.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link
                      href={
                        `/billing/contracts/${c.id}` as Parameters<typeof Link>[0]["href"]
                      }
                      className="text-sv-sky hover:underline"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
