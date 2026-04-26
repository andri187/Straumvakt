import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { listAllTariffs } from "@/lib/repositories/tariff-definitions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tariff definitions" };

export default async function TariffsPage() {
  const tariffs = await listAllTariffs();
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Tariff definitions"
        description="Per-Org rates per CostFactor. Sites and Installations reference these via the FK columns added in ADR 0008."
        primaryAction={{ href: "/billing/tariffs/new", label: "Add tariff" }}
      />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">All tariffs ({tariffs.length})</h2>
      {tariffs.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">No tariffs yet.</div>
      ) : (
        <ul className="divide-y divide-bg-border/60 rounded-md border border-bg-border bg-bg-base/30">
          {tariffs.map((t) => (
            <li key={t.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-medium text-ink-50">{t.displayName}</div>
                  <div className="text-xs text-ink-500">
                    Org: <Link className="text-sv-sky hover:underline" href={`/tenants/organizations/${t.orgId}`}>{t.orgDisplayName}</Link>
                    {" · "}Factor: <span className="font-mono text-sv-sky">{t.costFactorCode}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono text-ink-500">
                    VAT {t.vatRatePct}% · {t.currency} · valid from {new Date(t.validFrom).toISOString().slice(0, 10)}
                    {t.validUntil && ` until ${new Date(t.validUntil).toISOString().slice(0, 10)}`}
                  </div>
                  <div className="mt-1 text-[10px] font-mono text-ink-400">
                    {JSON.stringify(t.computeRule)}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-ink-500">{t.id.slice(0, 8)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
