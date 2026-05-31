// DSO rates catalogue page — /billing/dso
// Sprint 9 Track A. Replaces the prior reference-only stub.
//
// Two complementary panels:
//
//   1. DB panel  — billing.cost_factors with anchorTier="site" (per ADR 0008
//                  DSO factors anchor at site level). Shows per-org tariff
//                  usage, orphan flags, cross-ref gaps.
//   2. Reference panel — docs/reference/iceland-energy-parties.json DSO
//                  party tariff items, preserved from the prior version.
//
// CostFactor.anchorTier is the discriminator — there is no separate `kind`
// column on billing.cost_factors. DSO-level factors are those with
// anchorTier = "site".

import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import {
  filterByRole,
  loadCatalogue,
  type Party,
  type TariffItem,
} from "@/lib/reference/iceland-parties";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · DSO rates" };

// ── API types ──────────────────────────────────────────────────────────

interface DsoCostFactorTariffRef {
  id: string;
  displayName: string;
  status: string;
  currency: string;
  validFrom: string;
  validUntil: string | null;
  computeRuleKind: string | null;
  pricePerKwhMinor: string | null;
}

interface DsoCostFactorOrgEntry {
  orgId: string;
  orgDisplayName: string;
  tariffs: DsoCostFactorTariffRef[];
}

interface DsoCostFactor {
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
  tariffsByOrg: DsoCostFactorOrgEntry[];
}

interface DsoCatalogueSummary {
  totalFactors: number;
  totalTariffs: number;
  orphanFactors: number;
  factors: DsoCostFactor[];
}

// ── Formatters ────────────────────────────────────────────────────────

function fmtKr(minorStr: string | null): string {
  if (!minorStr) return "—";
  try {
    const minor = BigInt(minorStr);
    const whole = minor / 100n;
    const aurar = minor % 100n;
    const aurarStr = aurar < 10n ? `0${aurar}` : `${aurar}`;
    const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${wholeStr},${aurarStr} kr/kWh`;
  } catch {
    return "—";
  }
}

// ── Reference catalogue helper ─────────────────────────────────────────

type RefRow = {
  party: Party;
  item: TariffItem;
  uid: string;
};

function partyKey(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

// ── Page ──────────────────────────────────────────────────────────────

export default async function DsoRatesPage() {
  const cat = loadCatalogue();
  const dsoParties = cat ? filterByRole(cat.parties, "dso") : [];

  const refRows: RefRow[] = dsoParties.flatMap((p) => {
    const items = p.tariff_items ?? [];
    const prefix = partyKey(p.slug);
    return items.map((item, idx) => ({
      party: p,
      item,
      uid:
        item.code && item.code.trim().length > 0
          ? item.code
          : `${prefix}-DSOF-${String(idx + 1).padStart(2, "0")}`,
    }));
  });

  // Collect reference UIDs for cross-reference
  const refUids = new Set(refRows.map((r) => r.uid));

  // Fetch DB DSO factors
  let dbSummary: DsoCatalogueSummary | null = null;
  let dbError: string | null = null;
  try {
    dbSummary = await apiFetchServerJson<DsoCatalogueSummary>(
      "/api/admin/billing/dso",
    );
  } catch (err: unknown) {
    dbError = err instanceof Error ? err.message : "Unknown error loading DSO factors";
  }

  // Cross-reference: DB factor codes vs reference UIDs
  const dbCodes = new Set(dbSummary?.factors.map((f) => f.code) ?? []);
  const dbOnlyFactors = dbSummary?.factors.filter((f) => !refUids.has(f.code)) ?? [];
  const refOnlyUids = refRows.filter((r) => !dbCodes.has(r.uid));

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="DSO rates"
        description={
          <>
            Distribution-system-operator factors in{" "}
            <code className="font-mono text-xs">billing.cost_factors</code> (
            <code className="font-mono text-xs">anchorTier=site</code>) cross-referenced
            against the{" "}
            <Link href="/reference/electricity/dso" className="text-sv-sky hover:underline">
              reference catalogue
            </Link>
            . Create a TariffDefinition under{" "}
            <Link href="/billing/tariffs" className="text-sv-sky hover:underline">
              /billing/tariffs
            </Link>{" "}
            to make a rate billable.
          </>
        }
      />

      {/* Tile dashboard */}
      {dbSummary && (
        <div className="mb-6 grid grid-cols-3 gap-3">
          <Tile label="DSO factors (DB)" value={String(dbSummary.totalFactors)} />
          <Tile
            label="Tariffs anchored to DSO factors"
            value={String(dbSummary.totalTariffs)}
          />
          <Tile
            label="Orphan factors"
            value={String(dbSummary.orphanFactors)}
            tone={dbSummary.orphanFactors > 0 ? "amber" : undefined}
          />
        </div>
      )}

      {/* DB error notice */}
      {dbError && (
        <div className="mb-4 rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Could not load DB DSO factors: {dbError}
        </div>
      )}

      {/* Cross-reference gap notices */}
      {dbSummary && dbOnlyFactors.length > 0 && (
        <div className="mb-4 rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          <span className="font-semibold">
            {dbOnlyFactors.length} DB factor{dbOnlyFactors.length === 1 ? "" : "s"} not
            found in reference catalogue:
          </span>{" "}
          {dbOnlyFactors.map((f) => (
            <code key={f.id} className="mr-2 font-mono">
              {f.code}
            </code>
          ))}
        </div>
      )}
      {dbSummary && refOnlyUids.length > 0 && (
        <div className="mb-4 rounded border border-sv-sky/30 bg-sv-sky/5 p-3 text-xs text-sv-sky">
          <span className="font-semibold">
            {refOnlyUids.length} reference entry{refOnlyUids.length === 1 ? "" : "s"} not
            yet seeded as a DB cost factor:
          </span>{" "}
          {refOnlyUids.map((r) => (
            <code key={r.uid} className="mr-2 font-mono">
              {r.uid}
            </code>
          ))}
        </div>
      )}

      {/* DB section */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
          DB cost factors (anchorTier = site)
        </h2>
        {!dbSummary ? (
          <div className="rounded border border-dashed border-bg-border p-4 text-center text-sm text-ink-500">
            {dbError ? "Failed to load." : "Loading…"}
          </div>
        ) : dbSummary.factors.length === 0 ? (
          <div className="rounded border border-dashed border-bg-border p-4 text-center text-sm text-ink-500">
            No site-anchored cost factors in the database yet. Seed via
            apps/api/scripts/seed-*.ts.
          </div>
        ) : (
          <div className="space-y-4">
            {dbSummary.factors.map((f) => (
              <DbFactorCard key={f.id} factor={f} inRef={refUids.has(f.code)} />
            ))}
          </div>
        )}
      </section>

      {/* Reference catalogue section */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
          Reference catalogue — DSO parties
        </h2>
        {!cat ? (
          <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
            Reference catalogue file not found. Expected at{" "}
            <code className="font-mono">docs/reference/iceland-energy-parties.json</code>.
          </div>
        ) : refRows.length === 0 ? (
          <div className="rounded border border-dashed border-bg-border p-4 text-center text-sm text-ink-500">
            No DSO tariff items in the catalogue.
          </div>
        ) : (
          <RefRatesTable rows={refRows} dbCodes={dbCodes} />
        )}
        {dsoParties.length > 0 && (
          <p className="mt-3 text-[11px] text-ink-500">
            {dsoParties.length} DSO{dsoParties.length === 1 ? "" : "s"} ·{" "}
            {refRows.length} tariff row{refRows.length === 1 ? "" : "s"}
            {cat?.meta?.last_verified_on && (
              <> · last verified {cat.meta.last_verified_on}</>
            )}
          </p>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "amber";
}) {
  const accent =
    tone === "amber"
      ? "border-amber-700/40 bg-amber-950/20"
      : "border-bg-border bg-bg-base/30";
  return (
    <div className={`rounded-lg border p-4 ${accent}`}>
      <p className="text-[10px] uppercase tracking-brand text-ink-500">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-semibold " +
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
        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-brand " + tone
      }
    >
      {status}
    </span>
  );
}

function DbFactorCard({
  factor,
  inRef,
}: {
  factor: DsoCostFactor;
  inRef: boolean;
}) {
  return (
    <div
      className={
        "rounded-lg border p-4 " +
        (factor.isOrphan
          ? "border-amber-700/40 bg-amber-950/10"
          : "border-bg-border bg-bg-base/30")
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-sv-sky">
          {factor.code}
        </span>
        <span className="text-sm text-ink-200">{factor.displayName}</span>
        <StatusBadge status={factor.status} />
        {factor.isOrphan && (
          <span className="rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-0.5 text-[9px] uppercase tracking-brand text-amber-300">
            orphan
          </span>
        )}
        {!inRef && (
          <span className="rounded border border-sv-sky/30 bg-sv-sky/10 px-1.5 py-0.5 text-[9px] uppercase tracking-brand text-sv-sky">
            not in reference
          </span>
        )}
      </div>
      {factor.description && (
        <p className="mb-2 text-xs text-ink-400">{factor.description}</p>
      )}
      <div className="mb-3 flex flex-wrap gap-4 text-[11px] text-ink-500">
        <span>
          anchor: <span className="font-mono text-ink-300">{factor.anchorTier}</span>
        </span>
        <span>
          default VAT:{" "}
          <span className="font-mono text-ink-300">{factor.defaultVatRatePct}%</span>
        </span>
        <span>
          currency:{" "}
          <span className="font-mono text-ink-300">{factor.defaultCurrency}</span>
        </span>
        <span>
          tariff definitions:{" "}
          <span className="font-mono text-ink-200">{factor.tariffCount}</span>
        </span>
      </div>

      {factor.tariffsByOrg.length === 0 ? (
        <p className="text-[11px] text-ink-600">
          No TariffDefinition rows reference this factor yet.
        </p>
      ) : (
        <div className="space-y-2">
          {factor.tariffsByOrg.map((org) => (
            <div key={org.orgId}>
              <p className="mb-1 text-[10px] uppercase tracking-brand text-ink-500">
                {org.orgDisplayName}
              </p>
              <div className="flex flex-wrap gap-2">
                {org.tariffs.map((t) => (
                  <Link
                    key={t.id}
                    href={`/billing/tariffs/${t.id}` as Parameters<typeof Link>[0]["href"]}
                    className="flex items-center gap-1.5 rounded border border-bg-border bg-bg-inset/40 px-2 py-1 text-[11px] hover:border-sv-sky/40"
                  >
                    <span className="text-ink-200">{t.displayName}</span>
                    <StatusBadge status={t.status} />
                    {t.pricePerKwhMinor && (
                      <span className="font-mono text-ink-400">
                        {fmtKr(t.pricePerKwhMinor)}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RefRatesTable({
  rows,
  dbCodes,
}: {
  rows: RefRow[];
  dbCodes: Set<string>;
}) {
  return (
    <table className="w-full overflow-hidden rounded-md border border-bg-border bg-bg-base/30 text-sm">
      <thead className="bg-bg-base/50 text-[10px] uppercase tracking-brand text-ink-400">
        <tr>
          <th className="px-3 py-2 text-left">Party</th>
          <th className="px-3 py-2 text-left">UID</th>
          <th className="px-3 py-2 text-left">Tariff</th>
          <th className="px-3 py-2 text-left">Applies to</th>
          <th className="px-3 py-2 text-left">Unit</th>
          <th className="px-3 py-2 text-right">Price (no VAT)</th>
          <th className="px-3 py-2 text-right">Price (with VAT)</th>
          <th className="px-3 py-2 text-right">VAT %</th>
          <th className="px-3 py-2 text-center">In DB</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-bg-border/60">
        {rows.map(({ party, item, uid }) => {
          const inDb = dbCodes.has(uid);
          return (
            <tr
              key={`${party.slug}:${uid}`}
              className={"hover:bg-bg-base/20 " + (!inDb ? "opacity-70" : "")}
            >
              <td className="px-3 py-2">
                <div className="text-ink-100">{party.trade_name}</div>
                {party.service_area?.description && (
                  <div className="text-[10px] text-ink-500">
                    {party.service_area.description}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-sv-sky">{uid}</td>
              <td className="px-3 py-2 text-ink-200">
                {item.display_name}
                {item.ev_category && (
                  <span className="ml-2 rounded bg-sv-green/15 px-1 py-0.5 font-mono text-[9px] uppercase text-sv-green">
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
              <td className="px-3 py-2 text-center">
                {inDb ? (
                  <span className="text-[10px] text-emerald-400">yes</span>
                ) : (
                  <span className="text-[10px] text-ink-600">—</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
