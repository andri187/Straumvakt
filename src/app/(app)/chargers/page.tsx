import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { ChargerSummary } from "@straumvakt/shared/domain/chargers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chargers" };

export default async function ChargersPage() {
  const { chargers } = await apiFetchServerJson<{ chargers: ChargerSummary[] }>(
    "/api/admin/chargers",
  );

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
            <li
              key={c.chargingStationId}
              className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
            >
              <Link
                href={`/chargers/${c.chargingStationId}`}
                className="shrink-0 font-mono text-sm font-medium text-ink-50 hover:text-sv-sky"
              >
                {c.identityString}
              </Link>
              {c.serialNumber && c.serialNumber !== c.identityString && (
                <span className="shrink-0 font-mono text-[10px] text-ink-500">
                  {c.serialNumber}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-ink-500">
                {c.orgDisplayName}
                {" · "}
                {c.siteDisplayName}
                {c.vendor && c.model && (
                  <>
                    {" · "}
                    <span className="text-ink-300">
                      {c.vendor} {c.model}
                    </span>
                  </>
                )}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-ink-500">
                {c.ocppVersion} · {c.connectorType}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
