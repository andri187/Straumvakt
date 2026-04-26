import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { filterByRole, loadCatalogue, type Party, type TariffItem } from "@/lib/reference/iceland-parties";

export const dynamic = "force-dynamic";
export const metadata = { title: "DSO rates" };

type Row = {
  party: Party;
  item: TariffItem;
};

export default async function DsoRatesPage() {
  const cat = loadCatalogue();
  const parties = cat ? filterByRole(cat.parties, "dso") : [];

  const rows: Row[] = parties.flatMap((p) =>
    (p.tariff_items ?? []).map((item) => ({ party: p, item })),
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="DSO rates"
        description={
          <>
            Distribution-system-operator tariffs flattened from{" "}
            <Link href="/reference/electricity/dso" className="text-sv-sky hover:underline">
              the reference catalogue
            </Link>{" "}
            (<code className="font-mono">docs/reference/iceland-energy-parties.json</code>).
            Anchor for the <span className="font-mono">DSOF</span> cost factor at the Site
            level. Numbers here are reference values; create a Tariff
            definition under{" "}
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
          No DSO tariff items in the catalogue.
        </div>
      ) : (
        <RatesTable rows={rows} />
      )}

      {parties.length > 0 && (
        <p className="mt-4 text-[11px] text-ink-500">
          {parties.length} DSO{parties.length === 1 ? "" : "s"} ·{" "}
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
          <th className="px-3 py-2 text-left">Code</th>
          <th className="px-3 py-2 text-left">Tariff</th>
          <th className="px-3 py-2 text-left">Applies to</th>
          <th className="px-3 py-2 text-left">Unit</th>
          <th className="px-3 py-2 text-right">Price (no VAT)</th>
          <th className="px-3 py-2 text-right">Price (with VAT)</th>
          <th className="px-3 py-2 text-right">VAT %</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-bg-border/60">
        {rows.map(({ party, item }, i) => (
          <tr key={`${party.slug}:${item.code ?? i}:${item.display_name}`} className="hover:bg-bg-base/20">
            <td className="px-3 py-2">
              <div className="text-ink-100">{party.trade_name}</div>
              {party.service_area?.description && (
                <div className="text-[10px] text-ink-500">{party.service_area.description}</div>
              )}
            </td>
            <td className="px-3 py-2 font-mono text-[11px] text-sv-sky">{item.code ?? "—"}</td>
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
