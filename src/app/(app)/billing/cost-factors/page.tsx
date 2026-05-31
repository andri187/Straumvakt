// Read-only cost-factor catalogue surface. Sprint 9 — Track B.
//
// Shows all billing.cost_factors rows grouped by anchorTier.
// The anchorTier enum (org | property | site | installation | circuit |
// charger | driver_contract) is the schema's discriminator for what kind
// of cost a factor represents and at which level it is anchored.
//
// Orphan highlighting: factors with zero TariffDefinitions referencing
// them are flagged — they are seeded but not yet wired to any tariff.

import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Cost factors" };

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror the API response shape
// ─────────────────────────────────────────────────────────────────────────────

interface CostFactorRow {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  anchorTier: string;
  defaultVatRatePct: string;
  defaultCurrency: string;
  status: string;
  tariffCount: number;
  isOrphan: boolean;
}

interface CostFactorsByAnchor {
  anchor: string;
  factors: CostFactorRow[];
}

interface CostFactorCatalogueSummary {
  totalFactors: number;
  orphanCount: number;
  byAnchor: CostFactorsByAnchor[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Human-readable label for each anchorTier value. */
function anchorLabel(tier: string): string {
  switch (tier) {
    case "org":             return "Organisation";
    case "property":        return "Property";
    case "site":            return "Site  (DSO-level)";
    case "installation":    return "Installation  (retailer-level)";
    case "circuit":         return "Circuit";
    case "charger":         return "Charger";
    case "driver_contract": return "Driver contract";
    default:                return tier;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function CostFactorsPage() {
  const summary = await apiFetchServerJson<CostFactorCatalogueSummary>(
    "/api/admin/billing/cost-factors",
  );

  // Build per-anchor counts for the tile row.
  const anchorCounts = summary.byAnchor.map((g) => ({
    anchor: g.anchor,
    count: g.factors.length,
  }));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Cost factor catalogue"
        description="Platform-defined billing.cost_factors rows. Each factor is anchored to a tier in the site hierarchy (org → property → site → installation → circuit → charger → driver_contract). A factor's anchorTier determines which entity FK links to it and which TariffDefinition kind references it. Factors with zero tariff references are orphaned — seeded but not yet wired."
      />

      {/* Tile dashboard */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Tile label="Factors total" value={String(summary.totalFactors)} />
        <Tile label="Anchor tiers" value={String(summary.byAnchor.length)} />
        <Tile
          label="Orphans (no tariffs)"
          value={String(summary.orphanCount)}
          tone={summary.orphanCount > 0 ? "amber" : undefined}
        />
        {anchorCounts.map(({ anchor, count }) => (
          <Tile
            key={anchor}
            label={anchorLabel(anchor)}
            value={String(count)}
            small
          />
        ))}
      </div>

      {summary.byAnchor.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No cost factors found. Seed via apps/api/scripts/seed-*.ts.
        </div>
      ) : (
        summary.byAnchor.map(({ anchor, factors }) => (
          <section key={anchor} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
              {anchorLabel(anchor)}{" "}
              <span className="normal-case text-ink-500">({factors.length})</span>
            </h2>
            <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
              <table className="w-full text-xs">
                <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                  <tr className="text-left">
                    <th className="px-3 py-2">Code</th>
                    <th className="px-3 py-2">Display name</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2 text-right">Default VAT</th>
                    <th className="px-3 py-2">Currency</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Tariffs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/40">
                  {factors.map((f) => (
                    <tr
                      key={f.id}
                      className={
                        "hover:bg-bg-base/20 " +
                        (f.isOrphan ? "bg-amber-950/10" : "")
                      }
                    >
                      <td className="px-3 py-1.5 font-mono text-[11px] text-sv-sky">
                        {f.code}
                        {f.isOrphan && (
                          <span className="ml-2 rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-0.5 text-[9px] uppercase tracking-brand text-amber-300">
                            orphan
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-ink-100">{f.displayName}</td>
                      <td className="px-3 py-1.5 text-ink-400 italic">
                        {f.description ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-ink-300">
                        {f.defaultVatRatePct}%
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-400">
                        {f.defaultCurrency}
                      </td>
                      <td className="px-3 py-1.5">
                        <StatusBadge status={f.status} />
                      </td>
                      <td className="px-3 py-1.5 text-right text-ink-300">
                        {f.tariffCount === 0 ? (
                          <span className="text-amber-400">0</span>
                        ) : (
                          f.tariffCount
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: "amber";
  small?: boolean;
}) {
  const accent =
    tone === "amber"
      ? "border-amber-700/40 bg-amber-950/20"
      : "border-bg-border bg-bg-base/30";
  return (
    <div className={`rounded-lg border p-4 ${accent}`}>
      <p className="text-[10px] uppercase tracking-brand text-ink-500">
        {label}
      </p>
      <p
        className={
          (small ? "mt-1 text-xl font-semibold " : "mt-1 text-2xl font-semibold ") +
          (tone === "amber" ? "text-amber-200" : "text-ink-50")
        }
      >
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "border-emerald-700/40 bg-emerald-950/30 text-emerald-300"
      : status === "draft"
        ? "border-sv-sky/30 bg-sv-sky/10 text-sv-sky"
        : "border-bg-border bg-bg-base/40 text-ink-400";
  return (
    <span
      className={
        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-brand " +
        tone
      }
    >
      {status}
    </span>
  );
}
