import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { listAllCostCenters } from "@/lib/repositories/cost-centers";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreateCostCenterForm } from "./create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cost centers" };

export default async function CostCentersPage() {
  const [costCenters, orgs] = await Promise.all([listAllCostCenters(), listOrgs()]);
  const orgOptions = orgs.filter((o) => o.status !== "archived").map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Cost centers</h1>
        <p className="mt-1 text-sm text-ink-400">
          Who pays / who benefits. Each contract assignment routes a cost
          factor to one of these. Exactly zero or one of payerOrg /
          payerUser may be set (a Cost Center either bills another Org or
          a User, not both — ADR 0008).
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
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
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">Create cost center</h2>
          {orgOptions.length === 0 ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">Create an Organization first.</div>
          ) : (
            <CreateCostCenterForm orgOptions={orgOptions} />
          )}
        </aside>
      </div>
    </div>
  );
}
