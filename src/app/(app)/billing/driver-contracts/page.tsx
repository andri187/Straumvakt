import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { listAllDriverContracts } from "@/lib/repositories/driver-contracts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Driver contracts" };

export default async function DriverContractsPage() {
  const contracts = await listAllDriverContracts();
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Driver contracts"
        description={
          <>
            Per-User overrides on top of Org contracts. Owner type:
            <span className="ml-1 font-mono">workplace</span> (employer pays),{" "}
            <span className="font-mono">family_group</span> (family owner pays),{" "}
            <span className="font-mono">self</span>.
          </>
        }
        primaryAction={{ href: "/billing/driver-contracts/new", label: "Add driver contract" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All driver contracts ({contracts.length})</h2>
      {contracts.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No driver contracts yet.</div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {contracts.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-ink-50">{c.displayName}</div>
                  <div className="text-xs text-ink-500">
                    Org: <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${c.orgId}`}>{c.orgDisplayName}</Link>
                    {" · User: "}<span className="text-ink-300">{c.userEmail ?? c.userId.slice(0, 8)}</span>
                    {" · "}<span className="font-mono rounded bg-sv-sky/10 px-1.5 py-0.5 text-[10px] text-sv-sky">{c.ownerType}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-ink-500">
                    {c.status} · valid from {new Date(c.validFrom).toISOString().slice(0, 10)}
                    {c.wrkpfTariffId && ` · WRKPF tariff ${c.wrkpfTariffId.slice(0, 8)}`}
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
