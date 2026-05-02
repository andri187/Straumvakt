import Link from "next/link";
import { apiFetchServer } from "@/lib/api-client-server";
import type { ContractSummary } from "@straumvakt/shared/domain/contracts";

export const metadata = { title: "Organization · Contracts" };

/**
 * Contracts tab. Shows org-level Contracts (billing.contracts) — the
 * billing scaffolding for tariff resolution, factor allocation, and
 * cost-center splitting. DriverContracts (per-driver, people schema)
 * surface separately on the Driver groups / Drivers views once the
 * Sprint 5 user-import flow lands.
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
        Org-level contracts only (billing.contracts). DriverContracts
        (per-driver) surface in the Driver groups view.
      </p>

      {contracts.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No contracts for this organization yet.
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
