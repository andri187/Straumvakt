import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { listAllInstallations } from "@/lib/repositories/installations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Installations" };

export default async function InstallationsPage() {
  const installations = await listAllInstallations();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <ActionBar
        title="Installations"
        description="A vendor installation under a Site — typically a Zaptec or Easee deployment. Holds the vendor reference + retailer tariff anchor (ADR 0008). Zaptec OAuth auto-fetch arrives at milestone 2.7."
        primaryAction={{ href: "/installations/new", label: "Add installation" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
        All installations ({installations.length})
      </h2>
      {installations.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No installations yet.</div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {installations.map((i) => (
            <li key={i.id} className="px-4 py-3 hover:bg-bg-base/20">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-ink-50">
                    <Link href={`/installations/${i.id}`} className="hover:text-sv-sky">
                      {i.displayName}
                    </Link>
                  </div>
                  <div className="text-xs text-ink-500">
                    Org: <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${i.orgId}`}>{i.orgDisplayName}</Link>
                    {" · "}Site: <span className="text-ink-300">{i.siteDisplayName}</span>
                    {i.vendorSlug && <span className="ml-2 rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">{i.vendorSlug}</span>}
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-ink-500">{i.onboardingStatus}{i.vendorInstallationRef && ` · ref ${i.vendorInstallationRef}`}</div>
                </div>
                <span className="font-mono text-[10px] text-ink-500">{i.id.slice(0, 8)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
