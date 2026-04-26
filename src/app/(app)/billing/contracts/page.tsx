import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { listAllContracts } from "@/lib/repositories/contracts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contracts" };

export default async function ContractsPage() {
  const contracts = await listAllContracts();
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Contracts"
        description="Org-rooted contracts with scoped overrides (ADR 0008). Deepest scope wins; missing factors fall through to the parent."
        primaryAction={{ href: "/billing/contracts/new", label: "Add contract" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All contracts ({contracts.length})</h2>
      {contracts.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No contracts yet.</div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {contracts.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-ink-50">{c.displayName}</div>
                  <div className="text-xs text-ink-500">
                    Org: <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${c.orgId}`}>{c.orgDisplayName}</Link>
                    {" · "}<span className="font-mono">{c.scopeType}</span>
                    {c.scopeId && <span className="ml-1 font-mono text-ink-400">({c.scopeId.slice(0, 8)})</span>}
                    {c.parentContractId && <span className="ml-2 rounded bg-bg-base/40 px-1.5 py-0.5 text-[10px] text-ink-400">child of {c.parentContractId.slice(0, 8)}</span>}
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-ink-500">
                    {c.status} · valid from {new Date(c.validFrom).toISOString().slice(0, 10)}
                    {c.validUntil && ` until ${new Date(c.validUntil).toISOString().slice(0, 10)}`}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-ink-500">{c.id.slice(0, 8)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
