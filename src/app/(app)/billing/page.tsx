import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { listCostFactors } from "@/lib/repositories/cost-factors";
import { listAllTariffs } from "@/lib/repositories/tariff-definitions";
import { listAllCostCenters } from "@/lib/repositories/cost-centers";
import { listAllContracts } from "@/lib/repositories/contracts";
import { listAllDriverContracts } from "@/lib/repositories/driver-contracts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

type Row = {
  type: "Cost factor" | "Tariff" | "Cost center" | "Contract" | "Driver contract";
  href: string;
  name: string;
  detail: string;
  owner: string;
  id: string;
  sortKey: string;
};

export default async function BillingPage() {
  const [factors, tariffs, costCenters, contracts, driverContracts] = await Promise.all([
    listCostFactors(),
    listAllTariffs(),
    listAllCostCenters(),
    listAllContracts(),
    listAllDriverContracts(),
  ]);

  const rows: Row[] = [
    ...factors.map((f): Row => ({
      type: "Cost factor",
      href: "/billing/cost-factors",
      name: `${f.code} — ${f.displayName}`,
      detail: `anchor ${f.anchorTier} · VAT ${f.defaultVatRatePct}%`,
      owner: "platform",
      id: f.id,
      sortKey: `0:${f.code}`,
    })),
    ...tariffs.map((t): Row => ({
      type: "Tariff",
      href: "/billing/tariffs",
      name: t.displayName,
      detail: `factor ${t.costFactorCode} · VAT ${t.vatRatePct}%`,
      owner: t.orgDisplayName,
      id: t.id,
      sortKey: `1:${t.validFrom}`,
    })),
    ...costCenters.map((c): Row => ({
      type: "Cost center",
      href: "/billing/cost-centers",
      name: `${c.code} — ${c.displayName}`,
      detail: c.payerOrgDisplayName ? `payer ${c.payerOrgDisplayName}` : c.payerUserId ? `payer user ${c.payerUserId.slice(0, 8)}` : "no payer",
      owner: c.orgDisplayName,
      id: c.id,
      sortKey: `2:${c.code}`,
    })),
    ...contracts.map((c): Row => ({
      type: "Contract",
      href: "/billing/contracts",
      name: c.displayName,
      detail: `scope ${c.scopeType} · ${c.status}`,
      owner: c.orgDisplayName,
      id: c.id,
      sortKey: `3:${c.validFrom}`,
    })),
    ...driverContracts.map((c): Row => ({
      type: "Driver contract",
      href: "/billing/driver-contracts",
      name: c.displayName,
      detail: `${c.ownerType} · ${c.status}${c.userEmail ? ` · ${c.userEmail}` : ""}`,
      owner: c.orgDisplayName,
      id: c.id,
      sortKey: `4:${c.validFrom}`,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const counts = {
    factors: factors.length,
    tariffs: tariffs.length,
    costCenters: costCenters.length,
    contracts: contracts.length,
    driverContracts: driverContracts.length,
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Billing</h1>
        <p className="mt-1 text-sm text-ink-400">
          Combined view: Cost factors ({counts.factors}), Tariffs ({counts.tariffs}), Cost centers ({counts.costCenters}), Contracts ({counts.contracts}), Driver contracts ({counts.driverContracts}).
          Click a row to open the corresponding tab.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          Nothing yet. Use the tabs above to create.
        </div>
      ) : (
        <table className="w-full overflow-hidden rounded-md border border-bg-border bg-bg-base/30 text-sm">
          <thead className="bg-bg-base/50 text-[10px] uppercase tracking-brand text-ink-400">
            <tr>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Detail</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border/60">
            {rows.map((r) => (
              <tr key={`${r.type}:${r.id}`} className="hover:bg-bg-base/20">
                <td className="px-3 py-2">
                  <span className={
                    "inline-block rounded px-1.5 py-0.5 font-mono text-[10px] " +
                    (r.type === "Cost factor"
                      ? "bg-sv-sky/15 text-sv-sky"
                      : r.type === "Tariff"
                      ? "bg-sv-green/15 text-sv-green"
                      : r.type === "Cost center"
                      ? "bg-amber-700/30 text-amber-200"
                      : r.type === "Contract"
                      ? "bg-purple-700/30 text-purple-200"
                      : "bg-rose-700/30 text-rose-200")
                  }>{r.type}</span>
                </td>
                <td className="px-3 py-2">
                  <Link href={r.href as Parameters<typeof Link>[0]["href"]} className="text-ink-100 hover:text-sv-sky">
                    {r.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-ink-400">{r.detail}</td>
                <td className="px-3 py-2 text-ink-400">{r.owner}</td>
                <td className="px-3 py-2 font-mono text-[10px] text-ink-500">{r.id.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
