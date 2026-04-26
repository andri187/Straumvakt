import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { listAllChargers } from "@/lib/repositories/chargers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chargers" };

export default async function ChargersPage() {
  const chargers = await listAllChargers();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={CHARGERS_TABS} />
      <ActionBar
        title="Onboarded chargers"
        description="Each row corresponds to a ChargingStation + EVSE + Connector + OCPP identity. The OCPP Basic-Auth password is revealed once after create."
        primaryAction={{ href: "/chargers/new", label: "Add charger" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All onboarded ({chargers.length})</h2>
      {chargers.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No chargers yet.</div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {chargers.map((c) => (
            <li key={c.chargingStationId} className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-ink-50">{c.identityString}</div>
                  <div className="text-xs text-ink-500">
                    {c.orgDisplayName} · {c.siteDisplayName}
                    {c.vendor && c.model && <> · <span className="text-ink-300">{c.vendor} {c.model}</span></>}
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-ink-500">{c.ocppVersion} · {c.connectorType}{c.serialNumber && ` · ${c.serialNumber}`}</div>
                </div>
                <span className="font-mono text-[10px] text-ink-500">{c.chargingStationId.slice(0, 8)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
