import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { ChargerSummary } from "@straumvakt/shared/domain/chargers";
import { ChargersTable } from "./chargers-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chargers" };

export default async function ChargersPage() {
  const { chargers } = await apiFetchServerJson<{ chargers: ChargerSummary[] }>(
    "/api/admin/chargers",
  );

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={CHARGERS_TABS} />
      <ActionBar
        title="Onboarded chargers"
        description="Each row corresponds to a ChargingStation + EVSE + Connector + OCPP identity. The OCPP Basic-Auth password is revealed once after create."
        primaryAction={{ href: "/chargers/new", label: "Add charger" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
        All onboarded ({chargers.length})
      </h2>
      {chargers.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No chargers yet.
        </div>
      ) : (
        <ChargersTable chargers={chargers} />
      )}
    </div>
  );
}
