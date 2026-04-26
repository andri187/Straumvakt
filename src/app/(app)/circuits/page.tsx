import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { listAllCircuits } from "@/lib/repositories/circuits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Circuits" };

export default async function CircuitsPage() {
  const circuits = await listAllCircuits();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <ActionBar
        title="Circuits"
        description="Optional electrical grouping between Site (or Installation) and Charging Station — gives Zaptec circuits and shared-amperage panels a structured home (ADR 0007)."
        primaryAction={{ href: "/circuits/new", label: "Add circuit" }}
      />

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
    </div>
  );
}
