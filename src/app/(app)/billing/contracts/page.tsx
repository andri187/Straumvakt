// Top-level Contracts list — Sprint 8.13. Platform-wide view of every
// contract across every org. Per-org slice lives at
// /accounts/organizations/[id]/contracts.

import Link from "next/link";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { ContractSummary } from "@straumvakt/shared/domain/contracts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Contracts" };

interface ContractsResponse {
  contracts: ContractSummary[];
}

export default async function ContractsPage() {
  const { contracts } = await apiFetchServerJson<ContractsResponse>(
    "/api/admin/contracts",
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Contracts</h1>
        <p className="mt-1 text-sm text-ink-400">
          Org-level billing contracts. Each row is a commercial arrangement
          between an organization and a counterparty (asset owner, fleet
          customer, property manager, …) scoped to a site, installation,
          or charger.
        </p>
      </header>

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          All contracts ({contracts.length})
        </h2>
      </div>

      {contracts.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-400">
          No contracts yet across any organization.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-bg-border bg-bg-base/30">
          <table className="w-full text-xs">
            <thead className="bg-bg-base/50 text-[10px] uppercase tracking-brand text-ink-500">
              <tr>
                <th className="px-3 py-2 text-left font-mono">UID</th>
                <th className="px-3 py-2 text-left">Contract</th>
                <th className="px-3 py-2 text-left">Owner org</th>
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
                  </td>
                  <td className="px-3 py-1.5">
                    <Link
                      href={
                        `/accounts/organizations/${c.orgId}` as Parameters<typeof Link>[0]["href"]
                      }
                      className="text-ink-300 hover:text-sv-sky"
                    >
                      {c.orgDisplayName}
                    </Link>
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
    </div>
  );
}
