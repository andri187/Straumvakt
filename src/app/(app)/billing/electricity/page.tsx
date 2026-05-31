// Electricity rates — combined reference catalogue + DB cost-factor view.
// Sprint 9 — Track B.
//
// Two sources are shown side-by-side on one page:
//
//   1. Reference catalogue (docs/reference/iceland-energy-parties.json)
//      — static JSON bundled at build time. Shows every Icelandic
//      electricity retailer and their per-kWh tariff items. This is
//      "what exists in Iceland" — informational, not operational.
//
//   2. DB cost factors (billing.cost_factors where anchorTier=installation)
//      — the operational rates actually configured per-org. These are
//      the REPF-family factors that attach at Installation level. Shows
//      which organisations have wired a retailer tariff and which have
//      not (orphans). This is "what we have configured."
//
// Mismatches between the two sets are informational — a factor in DB
// with no reference entry is fine (private/unlisted retailer); a
// reference retailer with no DB factor just means it hasn't been
// onboarded yet.

import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import {
  filterByRole,
  loadCatalogue,
  type Party,
  type TariffItem,
} from "@/lib/reference/iceland-parties";
import { apiFetchServerJson } from "@/lib/api-client-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Electricity rates" };

// ─────────────────────────────────────────────────────────────────────────────
// API response types
// ─────────────────────────────────────────────────────────────────────────────

interface OrgUsage {
  orgId: string;
  orgDisplayName: string;
  tariffCount: number;
}

interface ElectricityCostFactorRow {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  defaultVatRatePct: string;
  defaultCurrency: string;
  status: string;
  tariffCount: number;
  orgsUsing: OrgUsage[];
  isOrphan: boolean;
}

interface ElectricityCatalogueSummary {
  totalFactors: number;
  orphanCount: number;
  orgsCovered: number;
  factors: ElectricityCostFactorRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Reference catalogue helpers (reused from existing electricity page)
// ─────────────────────────────────────────────────────────────────────────────

type RefRow = {
  party: Party;
  item: TariffItem;
  uid: string;
};

function partyKey(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function isRetailElectricity(item: TariffItem): boolean {
  if (item.ev_category === "public_ev") return false;
  const unit = (item.unit ?? "").toLowerCase();
  return unit.includes("kwh");
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default async function ElectricityRatesPage() {
  // Load both data sources in parallel; tolerate API failure gracefully.
  const [dbSummary] = await Promise.all([
    apiFetchServerJson<ElectricityCatalogueSummary>(
      "/api/admin/billing/electricity",
    ).catch(
      (): ElectricityCatalogueSummary => ({
        totalFactors: 0,
        orphanCount: 0,
        orgsCovered: 0,
        factors: [],
      }),
    ),
  ]);

  // Reference catalogue.
  const cat = loadCatalogue();
  const retailers = cat ? filterByRole(cat.parties, "retailer") : [];
  const retailerSlugs = new Set(retailers.map((p) => p.slug));

  const refRows: RefRow[] = retailers.flatMap((p) => {
    const kept = (p.tariff_items ?? []).filter(isRetailElectricity);
    const prefix = partyKey(p.slug);
    return kept.map((item, idx) => ({
      party: p,
      item,
      uid:
        item.code && item.code.trim().length > 0
          ? item.code
          : `${prefix}-REPF-${String(idx + 1).padStart(2, "0")}`,
    }));
  });

  // Cross-reference: DB cost-factor codes vs reference retailer slugs.
  // The two sets use different identifier namespaces (DB codes like
  // "REPF" vs JSON slugs like "on", "n1"). We surface the sets
  // separately and flag DB factors with no matching reference entry —
  // that's informational: the factor is either a private retailer or
  // uses a non-standard code.
  const dbFactorCodes = new Set(dbSummary.factors.map((f) => f.code));
  const refOnlyCount = retailers.filter(
    (p) => !dbFactorCodes.has(p.slug.toUpperCase()),
  ).length;
  const dbOnlyCount = dbSummary.factors.filter(
    (f) => !retailerSlugs.has(f.code.toLowerCase()),
  ).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Electricity rates"
        description="Two data sources: the static reference catalogue (what exists in Iceland) and the operational billing.cost_factors with anchorTier=installation (what is configured in the DB). Mismatches are informational — a DB factor without a reference entry is a valid private/unlisted retailer."
      />

      {/* ── DB summary tiles ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="DB factors" value={String(dbSummary.totalFactors)} />
        <Tile label="Orgs covered" value={String(dbSummary.orgsCovered)} />
        <Tile
          label="DB orphans"
          value={String(dbSummary.orphanCount)}
          tone={dbSummary.orphanCount > 0 ? "amber" : undefined}
        />
        <Tile
          label="Ref-only retailers"
          value={String(refOnlyCount)}
          tone="info"
        />
      </div>

      {/* ── Section 1: DB cost factors ── */}
      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-brand text-ink-300">
          Operational DB factors{" "}
          <span className="normal-case text-ink-500">
            — billing.cost_factors where anchorTier = installation
          </span>
        </h2>

        {dbSummary.factors.length === 0 ? (
          <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
            No installation-tier cost factors found. Seed via
            apps/api/scripts/seed-*.ts.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
            <table className="w-full text-xs">
              <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                <tr className="text-left">
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Display name</th>
                  <th className="px-3 py-2 text-right">Default VAT</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Tariffs</th>
                  <th className="px-3 py-2">Orgs using</th>
                  <th className="px-3 py-2 text-center">Ref match</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border/40">
                {dbSummary.factors.map((f) => {
                  const hasRefMatch = retailerSlugs.has(f.code.toLowerCase());
                  return (
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
                      <td className="px-3 py-1.5 text-ink-100">
                        {f.displayName}
                        {f.description && (
                          <span className="ml-1 text-ink-500 italic">
                            · {f.description}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-ink-300">
                        {f.defaultVatRatePct}%
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
                      <td className="px-3 py-1.5 text-ink-400">
                        {f.orgsUsing.length === 0 ? (
                          <span className="text-ink-600">—</span>
                        ) : (
                          <span>
                            {f.orgsUsing
                              .map(
                                (o) =>
                                  `${o.orgDisplayName} (${o.tariffCount})`,
                              )
                              .join(", ")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center text-[11px]">
                        {hasRefMatch ? (
                          <span className="text-emerald-400" title="Matches a reference catalogue retailer slug">
                            yes
                          </span>
                        ) : (
                          <span className="text-ink-600" title="No matching reference catalogue slug — private or non-standard retailer">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {dbOnlyCount > 0 && (
          <p className="mt-2 text-[11px] text-ink-500">
            {dbOnlyCount} DB factor{dbOnlyCount === 1 ? "" : "s"} without a
            matching reference catalogue entry — informational only.
          </p>
        )}
      </section>

      {/* ── Section 2: Reference catalogue ── */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-brand text-ink-300">
          Reference catalogue{" "}
          <span className="normal-case text-ink-500">
            — docs/reference/iceland-energy-parties.json · retailer
            per-kWh rows
          </span>
        </h2>

        {!cat ? (
          <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
            Reference catalogue file not found. Expected at{" "}
            <code className="font-mono">
              docs/reference/iceland-energy-parties.json
            </code>
            .
          </div>
        ) : refRows.length === 0 ? (
          <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
            No retailer tariff items in the reference catalogue.
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
              <table className="w-full text-xs">
                <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                  <tr className="text-left">
                    <th className="px-3 py-2">Party</th>
                    <th className="px-3 py-2">UID</th>
                    <th className="px-3 py-2">Tariff</th>
                    <th className="px-3 py-2">Applies to</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2 text-right">No VAT</th>
                    <th className="px-3 py-2 text-right">With VAT</th>
                    <th className="px-3 py-2 text-right">VAT %</th>
                    <th className="px-3 py-2 text-center">In DB</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border/60">
                  {refRows.map(({ party, item, uid }) => {
                    const inDb = dbFactorCodes.has(party.slug.toUpperCase());
                    return (
                      <tr
                        key={`${party.slug}:${uid}`}
                        className="hover:bg-bg-base/20"
                      >
                        <td className="px-3 py-2">
                          <div className="text-ink-100">
                            {party.trade_name}
                          </div>
                          {party.service_area?.description && (
                            <div className="text-[10px] text-ink-500">
                              {party.service_area.description}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-sv-sky">
                          {uid}
                        </td>
                        <td className="px-3 py-2 text-ink-200">
                          {item.display_name}
                          {item.ev_category && (
                            <span className="ml-2 rounded bg-sv-sky/10 px-1 py-0.5 font-mono text-[9px] uppercase text-sv-sky">
                              {item.ev_category}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-ink-400">
                          {item.applies_to ?? "—"}
                        </td>
                        <td className="px-3 py-2 font-mono text-[11px] text-ink-400">
                          {item.unit ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink-200">
                          {item.price_no_vat ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-ink-100">
                          {item.price_with_vat ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-[11px] text-ink-400">
                          {item.vat_pct != null ? `${item.vat_pct}%` : "—"}
                        </td>
                        <td className="px-3 py-2 text-center text-[11px]">
                          {inDb ? (
                            <span
                              className="text-emerald-400"
                              title="Retailer slug matches a DB cost factor code"
                            >
                              yes
                            </span>
                          ) : (
                            <span
                              className="text-ink-600"
                              title="No DB cost factor with this retailer slug as code — not yet onboarded"
                            >
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-ink-500">
              {retailers.length} retailer{retailers.length === 1 ? "" : "s"} ·{" "}
              {refRows.length} tariff row{refRows.length === 1 ? "" : "s"}
              {cat.meta?.last_verified_on && (
                <> · last verified {cat.meta.last_verified_on}</>
              )}
              {" · "}
              Numbers here are reference values — create a Tariff definition
              under{" "}
              <Link
                href="/billing/tariffs"
                className="text-sv-sky hover:underline"
              >
                /billing/tariffs
              </Link>{" "}
              to make a rate billable.
            </p>
          </>
        )}
      </section>
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
}: {
  label: string;
  value: string;
  tone?: "amber" | "info";
}) {
  const accent =
    tone === "amber"
      ? "border-amber-700/40 bg-amber-950/20"
      : tone === "info"
        ? "border-sv-sky/20 bg-sv-sky/5"
        : "border-bg-border bg-bg-base/30";
  const textTone =
    tone === "amber"
      ? "text-amber-200"
      : tone === "info"
        ? "text-sv-sky"
        : "text-ink-50";
  return (
    <div className={`rounded-lg border p-4 ${accent}`}>
      <p className="text-[10px] uppercase tracking-brand text-ink-500">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${textTone}`}>{value}</p>
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
