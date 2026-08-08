// Per-org Tariff chain — Sprint 8.10. Read-only summary of every
// Site + Installation under the org with their bound DSO + retailer
// tariffs. Direct answer to "what is each site under this org being
// charged?". To change a binding, edit the Site or Installation
// directly — links surface inline.

import Link from "next/link";
import { apiFetchServerJson } from "@/lib/api-client-server";

export const metadata = { title: "Organization · Tariff chain" };
export const dynamic = "force-dynamic";

interface TariffSummary {
  id: string;
  displayName: string;
  pricePerKwhMinor: string | null;
  vatRatePct: number | null;
  status: string;
}

interface InstallationChainNode {
  installationId: string;
  displayName: string;
  retailerTariff: TariffSummary | null;
  stationCount: number;
}

interface SiteChainNode {
  siteId: string;
  displayName: string;
  dsoTariff: TariffSummary | null;
  installations: InstallationChainNode[];
}

interface SummaryResponse {
  summary: {
    orgId: string;
    sites: SiteChainNode[];
    unconfiguredCount: number;
  };
}

function formatRate(minor: string | null, vat: number | null): string {
  if (minor === null) return "—";
  const ex = Number(minor) / 100;
  if (vat === null) return `${ex.toFixed(2)} kr/kWh ex-VAT`;
  const inc = ex * (1 + vat / 100);
  return `${ex.toFixed(2)} kr/kWh ex-VAT  ·  ${inc.toFixed(2)} kr/kWh inc ${vat}% VAT`;
}

export default async function OrgTariffChainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await apiFetchServerJson<SummaryResponse>(
    `/api/admin/orgs/${id}/tariff-chain`,
  );
  const summary = data.summary;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-brand text-ink-300">
          Tariff chain
        </h2>
        {summary.unconfiguredCount > 0 ? (
          <span className="rounded bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-300">
            {summary.unconfiguredCount} unconfigured
          </span>
        ) : (
          <span className="rounded bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium uppercase text-emerald-300">
            fully configured
          </span>
        )}
      </div>

      <p className="mb-4 text-[11px] text-ink-500">
        DSO rate is anchored on the Site, retailer rate on the
        Installation. To change a binding, edit the Site or Installation
        directly — links open the right page.
      </p>

      {summary.sites.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No sites for this organization yet.
        </div>
      ) : (
        <ul className="space-y-3">
          {summary.sites.map((s) => (
            <li
              key={s.siteId}
              className="rounded-md border border-bg-border bg-bg-base/30 p-3"
            >
              <div className="mb-2 flex items-baseline gap-2">
                <Link
                  href={
                    `/sites/${s.siteId}` as Parameters<typeof Link>[0]["href"]
                  }
                  className="text-sm font-medium text-ink-50 hover:text-sv-sky"
                >
                  {s.displayName}
                </Link>
                <span className="text-[10px] uppercase tracking-brand text-ink-500">
                  Site
                </span>
              </div>

              <div className="mb-3 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
                <span className="text-ink-500">DSO tariff</span>
                <span
                  className={
                    s.dsoTariff ? "text-ink-100" : "text-amber-300"
                  }
                >
                  {s.dsoTariff
                    ? `${s.dsoTariff.displayName}  ·  ${formatRate(
                        s.dsoTariff.pricePerKwhMinor,
                        s.dsoTariff.vatRatePct,
                      )}`
                    : "Not configured — will throw at session-stop"}
                </span>
              </div>

              {s.installations.length === 0 ? (
                <p className="rounded border border-dashed border-bg-border/60 px-3 py-1.5 text-[11px] text-ink-500">
                  No installations under this site.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {s.installations.map((i) => (
                    <li
                      key={i.installationId}
                      className="rounded border border-bg-border/60 bg-bg-base/20 px-3 py-2"
                    >
                      <div className="mb-1 flex items-baseline gap-2">
                        <Link
                          href={
                            `/installations/${i.installationId}` as Parameters<typeof Link>[0]["href"]
                          }
                          className="text-xs font-medium text-ink-100 hover:text-sv-sky"
                        >
                          {i.displayName}
                        </Link>
                        <span className="text-[10px] uppercase tracking-brand text-ink-500">
                          Installation
                        </span>
                        <span className="ml-auto text-[10px] text-ink-500">
                          {i.stationCount}{" "}
                          {i.stationCount === 1 ? "charger" : "chargers"}
                        </span>
                      </div>
                      <div className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[11px]">
                        <span className="text-ink-500">Retailer tariff</span>
                        <span
                          className={
                            i.retailerTariff
                              ? "text-ink-100"
                              : "text-amber-300"
                          }
                        >
                          {i.retailerTariff
                            ? `${i.retailerTariff.displayName}  ·  ${formatRate(
                                i.retailerTariff.pricePerKwhMinor,
                                i.retailerTariff.vatRatePct,
                              )}`
                            : "Not configured — will throw at session-stop"}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
