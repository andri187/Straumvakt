import Link from "next/link";
import { SectionTabs, TENANTS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { PropertySummary } from "@straumvakt/shared/domain/properties";

export const dynamic = "force-dynamic";
export const metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const { properties } = await apiFetchServerJson<{ properties: PropertySummary[] }>(
    "/api/admin/properties",
  );
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={TENANTS_TABS} />
      <ActionBar
        title="Properties"
        description="Physical locations under an Organization. A Site lives inside a Property; a Property may contain many Sites."
        primaryAction={{ href: "/tenants/properties/new", label: "Add property" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
        All properties ({properties.length})
      </h2>
      {properties.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No properties yet.
        </div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {properties.map((p) => (
            <li key={p.id} className="px-4 py-3 hover:bg-bg-base/20">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-ink-50">
                    <Link href={`/tenants/properties/${p.id}`} className="hover:text-sv-sky">
                      {p.displayName}
                    </Link>
                  </div>
                  <div className="text-xs text-ink-500">
                    Org:{" "}
                    <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${p.orgId}`}>
                      {p.orgDisplayName}
                    </Link>
                    {p.locationType && <span className="ml-2 font-mono text-ink-400">{p.locationType}</span>}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-ink-500">{p.id.slice(0, 8)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
