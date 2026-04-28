import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { listAllSites } from "@/lib/repositories/sites";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sites" };

export default async function SitesPage() {
  const sites = await listAllSites();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <ActionBar
        title="Sites"
        description="A Site is a sub-location inside a Property — typically the area where chargers are installed. Tariff anchors (DSO, USRF, USRF premium, XTRRF, SPVIVF) attach here per ADR 0008."
        primaryAction={{ href: "/sites/new", label: "Add site" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
        All sites ({sites.length})
      </h2>
      {sites.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No sites yet.
        </div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {sites.map((s) => (
            <li key={s.id} className="px-4 py-3 hover:bg-bg-base/20">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-ink-50">
                    <Link href={`/sites/${s.id}`} className="hover:text-sv-sky">
                      {s.displayName}
                    </Link>
                  </div>
                  <div className="text-xs text-ink-500">
                    Org:{" "}
                    <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${s.orgId}`}>
                      {s.orgDisplayName}
                    </Link>
                    {" · "}Property:{" "}
                    <span className="text-ink-300">{s.propertyDisplayName}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-ink-500">
                    {s.siteType} · {s.accessLevel} · {s.timezone}
                    {s.powerClass && ` · ${s.powerClass}`}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-ink-500">{s.id.slice(0, 8)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
