// TariffDefinition catalogue surface — Sprint 9.
// Sprint 9 Track C: added New tariff button + detail links.

import Link from "next/link";
import { SectionTabs, OPERATIONS_TABS, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

interface TariffRow {
  id: string;
  orgId: string;
  orgDisplayName: string;
  displayName: string;
  currency: string;
  vatRatePct: string | null;
  status: string;
  costFactorCode: string | null;
  costFactorName: string | null;
  computeRuleKind: string | null;
  pricePerKwhMinor: string | null;
  sitesUsing: number;
  installationsUsing: number;
  stationsUsing: number;
  isOrphan: boolean;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Tariffs" };

function fmtKr(minorStr: string | null): string {
  if (!minorStr) return "—";
  try {
    const minor = BigInt(minorStr);
    const whole = minor / 100n;
    const aurar = minor % 100n;
    const aurarStr = aurar < 10n ? `0${aurar}` : `${aurar}`;
    const wholeStr = whole
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${wholeStr},${aurarStr} kr/kWh`;
  } catch {
    return "—";
  }
}

export default async function TariffsPage() {
  const { tariffs } = await apiFetchServerJson<{ tariffs: TariffRow[] }>(
    "/api/admin/billing/tariffs",
  );

  const byOrg = new Map<string, TariffRow[]>();
  for (const t of tariffs) {
    const arr = byOrg.get(t.orgDisplayName) ?? [];
    arr.push(t);
    byOrg.set(t.orgDisplayName, arr);
  }
  const orgs = Array.from(byOrg.keys()).sort();
  const orphanCount = tariffs.filter((t) => t.isOrphan).length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Tariff catalogue"
        description="Per-org TariffDefinition rows. The DSO and retailer rates that resolve at session-stop come from here, anchored to Site.dsoTariffId and Installation.retailerTariffId."
        primaryAction={{ href: "/billing/tariffs/new", label: "New tariff" }}
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Tile label="Tariffs total" value={String(tariffs.length)} />
        <Tile label="Organisations" value={String(orgs.length)} />
        <Tile
          label="Orphans (unused)"
          value={String(orphanCount)}
          tone={orphanCount > 0 ? "amber" : undefined}
        />
      </div>

      {orgs.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No tariff definitions yet. Seed via apps/api/scripts/seed-*.ts.
        </div>
      ) : (
        orgs.map((org) => {
          const rows = byOrg.get(org) ?? [];
          return (
            <section key={org} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
                {org} ({rows.length})
              </h2>
              <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
                <table className="w-full text-xs">
                  <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                    <tr className="text-left">
                      <th className="px-3 py-2">Tariff</th>
                      <th className="px-3 py-2">Factor</th>
                      <th className="px-3 py-2">Rule</th>
                      <th className="px-3 py-2 text-right">Rate</th>
                      <th className="px-3 py-2 text-right">VAT</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Sites</th>
                      <th className="px-3 py-2 text-right">Installs</th>
                      <th className="px-3 py-2 text-right">Stations</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-border/40">
                    {rows.map((t) => (
                      <tr
                        key={t.id}
                        className={
                          "hover:bg-bg-base/20 " +
                          (t.isOrphan ? "bg-amber-950/10" : "")
                        }
                      >
                        <td className="px-3 py-1.5 text-ink-100">
                          <Link
                            href={`/billing/tariffs/${t.id}` as Parameters<typeof Link>[0]["href"]}
                            className="hover:text-sv-sky hover:underline"
                          >
                            {t.displayName}
                          </Link>
                          {t.isOrphan && (
                            <span className="ml-2 rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-0.5 text-[9px] uppercase tracking-brand text-amber-300">
                              orphan
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                          {t.costFactorCode ?? "—"}
                          {t.costFactorName && (
                            <span className="ml-1 text-ink-600">
                              · {t.costFactorName}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                          {t.computeRuleKind ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-ink-200">
                          {fmtKr(t.pricePerKwhMinor)}
                        </td>
                        <td className="px-3 py-1.5 text-right text-ink-300">
                          {t.vatRatePct ? `${t.vatRatePct}%` : "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="px-3 py-1.5 text-right text-ink-300">
                          {t.sitesUsing}
                        </td>
                        <td className="px-3 py-1.5 text-right text-ink-300">
                          {t.installationsUsing}
                        </td>
                        <td className="px-3 py-1.5 text-right text-ink-300">
                          {t.stationsUsing}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

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
      <p className="text-[10px] uppercase tracking-brand text-ink-500">
        {label}
      </p>
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
        "rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-brand " +
        tone
      }
    >
      {status}
    </span>
  );
}
