import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS, CHARGERS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { ChargerSummary } from "@straumvakt/shared/domain/chargers";
import { ChargersTable } from "./chargers-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chargers" };

export default async function ChargersPage({
  searchParams,
}: {
  searchParams: Promise<{ "show-decom"?: string }>;
}) {
  const params = await searchParams;
  const showDecom = params["show-decom"] === "1";
  const { chargers } = await apiFetchServerJson<{ chargers: ChargerSummary[] }>(
    `/api/admin/chargers${showDecom ? "?includeDecommissioned=1" : ""}`,
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

      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          All onboarded ({chargers.length})
        </h2>
        <DecomToggle showDecom={showDecom} />
      </div>
      {chargers.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          {showDecom
            ? "No chargers — including decommissioned."
            : "No active chargers. Try Show decommissioned to see retired hardware."}
        </div>
      ) : (
        <ChargersTable chargers={chargers} />
      )}
    </div>
  );
}

// Sprint 9.7 — same UX as the /sites tree toggle. Default OFF;
// retired hardware (Zaptec Active=false / dropped from listChargers)
// is hidden from the at-a-glance view. Operator flips it ON to audit
// retired chargers without dragging their stats into the live fleet
// snapshot.
function DecomToggle({ showDecom }: { showDecom: boolean }) {
  const href = (showDecom ? "/chargers" : "/chargers?show-decom=1") as Parameters<
    typeof Link
  >[0]["href"];
  return (
    <Link
      href={href}
      className={
        "rounded border px-2 py-1 text-[11px] transition " +
        (showDecom
          ? "border-amber-500/50 bg-amber-950/30 text-amber-200 hover:bg-amber-950/50"
          : "border-bg-border bg-bg-base/40 text-ink-400 hover:bg-bg-raised hover:text-ink-100")
      }
      title={
        showDecom
          ? "Hide decommissioned chargers (Zaptec Active=false / dropped from listChargers)"
          : "Show decommissioned chargers — retired hardware that's still in our DB"
      }
    >
      {showDecom ? "Hide decommissioned" : "Show decommissioned"}
    </Link>
  );
}
