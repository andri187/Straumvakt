import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { listCostFactors } from "@/lib/repositories/cost-factors";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cost factors" };

export default async function CostFactorsPage() {
  const factors = await listCostFactors();
  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Cost factors</h1>
        <p className="mt-1 text-sm text-ink-400">
          Platform-managed catalog (ADR 0008). Read-only for org admins;
          new factors are added via Prisma seed by Straumvakt staff.
          Tariff definitions per organization reference these codes.
        </p>
      </header>

      <table className="w-full overflow-hidden rounded-md border border-bg-border bg-bg-base/30 text-sm">
        <thead className="bg-bg-base/50 text-[10px] uppercase tracking-brand text-ink-400">
          <tr>
            <th className="px-3 py-2 text-left">Code</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Anchor tier</th>
            <th className="px-3 py-2 text-right">Default VAT %</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-bg-border/60">
          {factors.map((f) => (
            <tr key={f.id} className="hover:bg-bg-base/20">
              <td className="px-3 py-2 font-mono text-sv-sky">{f.code}</td>
              <td className="px-3 py-2 text-ink-200">
                <div>{f.displayName}</div>
                {f.description && <div className="mt-0.5 text-[11px] text-ink-500">{f.description}</div>}
              </td>
              <td className="px-3 py-2 font-mono text-[11px] text-ink-400">{f.anchorTier}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-300">{f.defaultVatRatePct}%</td>
              <td className="px-3 py-2 text-[11px] font-mono text-ink-400">{f.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {factors.length === 0 && (
        <div className="mt-4 rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          No cost factors seeded. Run <code className="font-mono">npx prisma db seed</code>.
        </div>
      )}
    </div>
  );
}
