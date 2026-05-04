import Link from "next/link";
import { apiFetchServer } from "@/lib/api-client-server";
import type { ContractSummary } from "@straumvakt/shared/domain/contracts";

export const metadata = { title: "Organization · Cost arrangements" };

/**
 * Cost arrangements tab. Shows third-party billing contracts
 * (billing.contracts) — the scaffolding for cross-org cost-allocation,
 * factor splits, and cost-center routing when an organization other
 * than the operator is responsible for paying. Empty + harmless when
 * the org operates its own sites directly. The actual rate that
 * drives session cost lives on Site.dsoTariffId + Installation.retailerTariffId
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
          Cost arrangements ({contracts.length})
        </h2>
        <Link
          href={"/billing/contracts/new" as Parameters<typeof Link>[0]["href"]}
          className="rounded border border-bg-border px-3 py-1 text-xs text-ink-300 hover:bg-bg-base/40 hover:text-ink-100"
        >
          + Add arrangement
        </Link>
      </div>

      <p className="mb-3 text-[11px] text-ink-500">
        Third-party cost-allocation contracts only. The rate that drives
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
          <p className="mb-2">No third-party cost arrangements for this organization.</p>
          <p className="text-[11px] text-ink-500">
            That&apos;s the correct state when this org operates its own
            sites directly — pricing is driven by the bound DSO + retailer
            tariffs, not by a contract row. Add an arrangement here only
            when a separate organization (HOA, property manager, fleet
            customer) is responsible for paying for sessions at this
            org&apos;s sites.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {contracts.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
            >
              <Link
                href={`/billing/contracts/${c.id}` as Parameters<typeof Link>[0]["href"]}
                className="shrink-0 text-sm font-medium text-ink-50 hover:text-sv-sky"
              >
                {c.displayName}
              </Link>
              <span className="shrink-0 rounded bg-ink-800/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-300">
                {c.scopeType}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-500">
                Valid from {new Date(c.validFrom).toLocaleDateString()}
                {c.validUntil &&
                  ` to ${new Date(c.validUntil).toLocaleDateString()}`}
              </span>
              <span
                className={
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase " +
                  (c.status === "active"
                    ? "bg-emerald-950/40 text-emerald-300"
                    : c.status === "expired"
                      ? "bg-rose-950/40 text-rose-300"
                      : "bg-amber-950/40 text-amber-300")
                }
              >
                {c.status.replace(/_/g, " ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
