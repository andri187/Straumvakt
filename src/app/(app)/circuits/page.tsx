import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { CircuitSummary } from "@straumvakt/shared/domain/circuits";

export const dynamic = "force-dynamic";
export const metadata = { title: "Circuits" };

export default async function CircuitsPage() {
  const { circuits } = await apiFetchServerJson<{ circuits: CircuitSummary[] }>(
    "/api/admin/circuits",
  );

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
            <li
              key={c.id}
              className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-bg-base/20"
            >
              <Link
                href={`/circuits/${c.id}`}
                className="shrink-0 text-sm font-medium text-ink-50 hover:text-sv-sky"
              >
                {c.displayName}
              </Link>
              <span className="shrink-0 font-mono text-[10px] text-ink-500">
                {c.phaseCount}p{c.ampereCeiling && ` · ${c.ampereCeiling}A`}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-500">
                <Link className="text-sv-sky hover:underline" href={`/accounts/organizations/${c.orgId}` as Parameters<typeof Link>[0]["href"]}>
                  {c.orgDisplayName}
                </Link>
                {" · "}
                {c.siteDisplayName}
                {c.installationDisplayName && (
                  <>
                    {" · "}
                    {c.installationDisplayName}
                  </>
                )}
              </span>
              {c.vendorCircuitRef && (
                <span className="shrink-0 font-mono text-[10px] text-ink-500">
                  {c.vendorCircuitRef}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
