import Link from "next/link";
import { listAllCircuits } from "@/lib/repositories/circuits";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreateCircuitForm } from "./create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Circuits" };

export default async function CircuitsPage() {
  const [circuits, orgs] = await Promise.all([listAllCircuits(), listOrgs()]);
  const orgOptions = orgs.filter((o) => o.status !== "archived").map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Circuits</h1>
        <p className="mt-1 text-sm text-ink-400">
          Optional electrical grouping between Site (or Installation) and
          Charging Station — gives Zaptec circuits and shared-amperage
          panels a structured home (ADR 0007).
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All circuits ({circuits.length})</h2>
          {circuits.length === 0 ? (
            <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No circuits yet.</div>
          ) : (
            <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
              {circuits.map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <div>
                      <div className="text-sm font-medium text-ink-50">{c.displayName}</div>
                      <div className="text-xs text-ink-500">
                        Org: <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${c.orgId}`}>{c.orgDisplayName}</Link>
                        {" · "}Site: <span className="text-ink-300">{c.siteDisplayName}</span>
                        {c.installationDisplayName && <> · Installation: <span className="text-ink-300">{c.installationDisplayName}</span></>}
                      </div>
                      <div className="mt-0.5 text-[10px] font-mono text-ink-500">
                        {c.phaseCount}-phase{c.ampereCeiling && ` · ${c.ampereCeiling}A ceiling`}
                        {c.vendorCircuitRef && ` · ref ${c.vendorCircuitRef}`}
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
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">Create circuit</h2>
          {orgOptions.length === 0 ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">Create an Org + Property + Site first.</div>
          ) : (
            <CreateCircuitForm orgOptions={orgOptions} />
          )}
        </aside>
      </div>
    </div>
  );
}
