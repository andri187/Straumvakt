import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { filterByRole, loadCatalogue, type Party, type TariffItem } from "@/lib/reference/iceland-parties";

export const dynamic = "force-dynamic";
export const metadata = { title: "Electricity rates" };

type Row = {
  party: Party;
  item: TariffItem;
  uid: string;
};

// Stable UID per (party, REPF, position-among-kept-rows). Shown when the
// catalogue's `code` field is null. Format: <PARTY>-REPF-<NN> e.g. ON-REPF-01.
// Becomes editable once assigned to a TariffDefinition via /billing/tariffs.
function partyKey(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

export default async function ElectricityRatesPage() {
  const cat = loadCatalogue();
  const parties = cat ? filterByRole(cat.parties, "retailer") : [];

  // Only retail-electricity commodity rates. Excluded:
  //  - non-kWh units (monthly subscriptions, per-transaction fees)
  //  - public charging tariffs (those are CPO rates, surfaced under
  //    /reference/public-charging, not retail electricity from the
  //    customer's meter)
  function isRetailElectricity(item: TariffItem): boolean {
    if (item.ev_category === "public_ev") return false;
    const unit = (item.unit ?? "").toLowerCase();
    return unit.includes("kwh");
  }

  const rows: Row[] = parties.flatMap((p) => {
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Electricity rates"
        description={
          <>
            Electricity-retailer tariffs flattened from{" "}
            <Link href="/reference/electricity/retailers" className="text-sv-sky hover:underline">
              the reference catalogue
            </Link>{" "}
            (<code className="font-mono">docs/reference/iceland-energy-parties.json</code>).
            Retail electricity commodity rates only — per-kWh sale price
            at the customer&apos;s meter. Public-charging rates, monthly
            charger subscriptions, and per-transaction fees are filtered
            out (those live under the relevant Reference pages).
            Anchor for the <span className="font-mono">REPF</span> cost factor at the
            Installation level. Numbers here are reference values; create a
            Tariff definition under{" "}
            <Link href="/billing/tariffs" className="text-sv-sky hover:underline">/billing/tariffs</Link>{" "}
            to make a rate billable.
          </>
        }
      />

      {!cat ? (
        <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Reference catalogue file not found. Expected at{" "}
          <code className="font-mono">docs/reference/iceland-energy-parties.json</code>.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No retailer tariff items in the catalogue.
        </div>
      ) : (
        <RatesTable rows={rows} />
      )}

      {parties.length > 0 && (
        <p className="mt-4 text-[11px] text-ink-500">
          {parties.length} retailer{parties.length === 1 ? "" : "s"} ·{" "}
          {rows.length} tariff row{rows.length === 1 ? "" : "s"}
          {cat?.meta?.last_verified_on && <> · last verified {cat.meta.last_verified_on}</>}
        </p>
      )}
    </div>
  );
}

function RatesTable({ rows }: { rows: Row[] }) {
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
        </tr>
      </thead>
      <tbody className="divide-y divide-bg-border/60">
        {rows.map(({ party, item, uid }) => (
          <tr key={`${party.slug}:${uid}`} className="hover:bg-bg-base/20">
            <td className="px-3 py-2">
              <div className="text-ink-100">{party.trade_name}</div>
              {party.service_area?.description && (
                <div className="text-[10px] text-ink-500">{party.service_area.description}</div>
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
            <td className="px-3 py-2 text-[11px] text-ink-400">{item.applies_to ?? "—"}</td>
            <td className="px-3 py-2 font-mono text-[11px] text-ink-400">{item.unit ?? "—"}</td>
            <td className="px-3 py-2 text-right font-mono text-ink-200">
              {item.price_no_vat ?? "—"}
            </td>
            <td className="px-3 py-2 text-right font-mono text-ink-100">
              {item.price_with_vat ?? "—"}
            </td>
            <td className="px-3 py-2 text-right font-mono text-[11px] text-ink-400">
              {item.vat_pct != null ? `${item.vat_pct}%` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
