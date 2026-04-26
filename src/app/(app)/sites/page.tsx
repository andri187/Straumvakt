import Link from "next/link";
import { listAllSites } from "@/lib/repositories/sites";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreateSiteForm } from "./create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sites" };

export default async function SitesPage() {
  const [sites, orgs] = await Promise.all([listAllSites(), listOrgs()]);
  const orgOptions = orgs
    .filter((o) => o.status !== "archived")
    .map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Sites</h1>
        <p className="mt-1 text-sm text-ink-400">
          A Site is a sub-location inside a Property — typically the area
          where chargers are installed. Tariff anchors (DSO, USRF, USRF
          premium, XTRRF, SPVIVF) attach here per ADR 0008.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
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
                <li key={s.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-medium text-ink-50">{s.displayName}</div>
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
        </section>

        <aside>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">Create site</h2>
          {orgOptions.length === 0 ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
              Create an Organization + Property first.
            </div>
          ) : (
            <CreateSiteForm orgOptions={orgOptions} />
          )}
        </aside>
      </div>
    </div>
  );
}
