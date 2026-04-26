import Link from "next/link";
import { listAllProperties } from "@/lib/repositories/properties";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreatePropertyForm } from "./create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Properties" };

export default async function PropertiesPage() {
  const [properties, orgs] = await Promise.all([
    listAllProperties(),
    listOrgs(),
  ]);
  const orgOptions = orgs
    .filter((o) => o.status !== "archived")
    .map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Properties</h1>
        <p className="mt-1 text-sm text-ink-400">
          Physical locations under an Organization. A Site lives inside a
          Property; a Property may contain many Sites.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
            All properties ({properties.length})
          </h2>
          {properties.length === 0 ? (
            <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
              No properties yet. Create one →
            </div>
          ) : (
            <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
              {properties.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-medium text-ink-50">{p.displayName}</div>
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
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">Create property</h2>
          {orgOptions.length === 0 ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              No organizations exist yet. Create one first at{" "}
              <Link href="/tenants/organizations" className="underline">
                /tenants/organizations
              </Link>.
            </div>
          ) : (
            <CreatePropertyForm orgOptions={orgOptions} />
          )}
        </aside>
      </div>
    </div>
  );
}
