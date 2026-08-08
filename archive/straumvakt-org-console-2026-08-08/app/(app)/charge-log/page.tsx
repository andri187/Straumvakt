// Top-level Charge Log page — Sprint 8.4 read surface, enriched in 8.14.4,
// session-detail modal in 8.16, refactored to use ChargeLogTable in 8.4.x.
// Per-entity scoped views (per-org / per-site / per-charger / per-driver)
// reuse <ChargeLogTable scope={...} /> with the right scope tag.

import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { ChargeLogTable } from "./charge-log-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Charge log" };

export default async function ChargeLogPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <ActionBar
        title="Charge log"
        description="Per-session ledger across every connected charger. Each row is one closed charging session with its computed cost. Per-org / per-site / per-charger / per-driver scoped views appear on the corresponding profile pages."
      />
      <ChargeLogTable scope={{ kind: "admin" }} />
    </div>
  );
}
