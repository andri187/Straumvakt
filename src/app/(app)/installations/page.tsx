import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { listAllInstallations, listVendors } from "@/lib/repositories/installations";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreateInstallationForm } from "./create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Installations" };

export default async function InstallationsPage() {
  const [installations, orgs, vendors] = await Promise.all([
    listAllInstallations(),
    listOrgs(),
    listVendors(),
  ]);
  const orgOptions = orgs.filter((o) => o.status !== "archived").map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Installations</h1>
        <p className="mt-1 text-sm text-ink-400">
          A vendor installation under a Site — typically a Zaptec or Easee
          deployment. Holds the vendor reference + retailer tariff anchor
          (ADR 0008).
        </p>
        <p className="mt-2 rounded border border-amber-700/40 bg-amber-950/20 p-2 text-xs text-amber-200">
          Zaptec OAuth auto-fetch lands in milestone 2.7. For now: create
          the row manually with a vendor selected, then attach Charging
          Station(s) below.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All installations ({installations.length})</h2>
          {installations.length === 0 ? (
            <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No installations yet.</div>
          ) : (
            <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
              {installations.map((i) => (
                <li key={i.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-medium text-ink-50">{i.displayName}</div>
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
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">Create installation</h2>
          {orgOptions.length === 0 ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">Create an Organization, Property, and Site first.</div>
          ) : (
            <CreateInstallationForm orgOptions={orgOptions} vendorOptions={vendors} />
          )}
        </aside>
      </div>
    </div>
  );
}
