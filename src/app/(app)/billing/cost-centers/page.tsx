import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { listAllCostCenters } from "@/lib/repositories/cost-centers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cost centers" };

export default async function CostCentersPage() {
  const costCenters = await listAllCostCenters();
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Cost centers"
        description="Who pays / who benefits. Each contract assignment routes a cost factor to one of these. Exactly zero or one of payerOrg / payerUser may be set (ADR 0008)."
        primaryAction={{ href: "/billing/cost-centers/new", label: "Add cost center" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All cost centers ({costCenters.length})</h2>
      {costCenters.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No cost centers yet.</div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {costCenters.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-ink-50">
                    <span className="font-mono text-sv-sky">{c.code}</span>
                    {" — "}{c.displayName}
                  </div>
                  <div className="text-xs text-ink-500">
                    Owner: <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${c.orgId}`}>{c.orgDisplayName}</Link>
                    {c.payerOrgDisplayName && <> · Payer: {c.payerOrgDisplayName}</>}
                    {c.payerUserId && <> · Payer: user {c.payerUserId.slice(0, 8)}</>}
                    {c.beneficiaryOrgDisplayName && <> · Beneficiary: {c.beneficiaryOrgDisplayName}</>}
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
