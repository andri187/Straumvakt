// Tariff detail page — /billing/tariffs/[id]
// Sprint 9 Track A. Read-only surface.
//
// Shows header, "used by" sections (sites / installations / stations),
// cost factor block, and recent ledger entries for this tariff.

import Link from "next/link";
import {
  SectionTabs,
  OPERATIONS_TABS,
  BILLING_TABS,
} from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

export const dynamic = "force-dynamic";

// ── Types (mirror the repository output) ─────────────────────────────

interface TariffDetailHeader {
  id: string;
  orgId: string;
  orgDisplayName: string;
  displayName: string;
  currency: string;
  vatRatePct: string;
  status: string;
  validFrom: string;
  validUntil: string | null;
  computeRule: Record<string, unknown>;
  computeRuleKind: string | null;
  pricePerKwhMinor: string | null;
  costFactorId: string;
  costFactorCode: string;
  costFactorDisplayName: string;
  costFactorAnchorTier: string;
  costFactorStatus: string;
}

interface UsedBySite {
  siteId: string;
  displayName: string;
  orgId: string;
  orgDisplayName: string;
  role: "dso";
}

interface UsedByInstallation {
  installationId: string;
  displayName: string;
  siteId: string;
  siteDisplayName: string;
  orgId: string;
  orgDisplayName: string;
  role: "retailer";
}

interface UsedByStation {
  stationId: string;
  displayName: string;
  orgId: string;
  orgDisplayName: string;
  role: "chrgrf";
}

interface LedgerEntry {
  sessionId: string;
  orgId: string;
  orgDisplayName: string | null;
  siteId: string | null;
  siteDisplayName: string | null;
  chargingStationId: string | null;
  chargerDisplayName: string | null;
  startedAt: string;
  stoppedAt: string | null;
  energyKwh: string;
  costIskMinor: string | null;
}

interface TariffDetailResponse {
  tariff: TariffDetailHeader | null;
  usedBySites: UsedBySite[];
  usedByInstallations: UsedByInstallation[];
  usedByStations: UsedByStation[];
  isOrphan: boolean;
  recentLedger: LedgerEntry[];
}

// ── Formatters ────────────────────────────────────────────────────────

function fmtKr(minorStr: string | null, suffix = " kr/kWh"): string {
  if (!minorStr) return "—";
  try {
    const minor = BigInt(minorStr);
    const whole = minor / 100n;
    const aurar = minor % 100n;
    const aurarStr = aurar < 10n ? `0${aurar}` : `${aurar}`;
    const wholeStr = whole
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${wholeStr},${aurarStr}${suffix}`;
  } catch {
    return "—";
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("is-IS", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("is-IS", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function prettyRule(rule: Record<string, unknown>): string {
  if (!rule || Object.keys(rule).length === 0) return "—";
  try {
    return JSON.stringify(rule, null, 2);
  } catch {
    return "—";
  }
}

// ── Page ──────────────────────────────────────────────────────────────

export default async function TariffDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let data: TariffDetailResponse;
  try {
    data = await apiFetchServerJson<TariffDetailResponse>(
      `/api/admin/billing/tariffs/${id}/detail`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "not_found" || msg.startsWith("HTTP 404")) {
      return (
        <div className="mx-auto max-w-6xl px-6 py-8">
          <SectionTabs tabs={OPERATIONS_TABS} />
          <SectionTabs tabs={BILLING_TABS} />
          <div className="rounded border border-dashed border-bg-border p-8 text-center text-sm text-ink-500">
            Tariff not found.{" "}
            <Link href="/billing/tariffs" className="text-sv-sky hover:underline">
              Back to tariff catalogue
            </Link>
          </div>
        </div>
      );
    }
    throw err;
  }

  const { tariff, usedBySites, usedByInstallations, usedByStations, isOrphan, recentLedger } =
    data;

  if (!tariff) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <SectionTabs tabs={OPERATIONS_TABS} />
        <SectionTabs tabs={BILLING_TABS} />
        <div className="rounded border border-dashed border-bg-border p-8 text-center text-sm text-ink-500">
          Tariff not found.{" "}
          <Link href="/billing/tariffs" className="text-sv-sky hover:underline">
            Back to tariff catalogue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />

      <ActionBar
        title={tariff.displayName}
        description={
          <>
            <Link href="/billing/tariffs" className="text-sv-sky hover:underline">
              ← Tariff catalogue
            </Link>
            {isOrphan && (
              <span className="ml-3 rounded border border-amber-700/40 bg-amber-950/30 px-1.5 py-0.5 text-[9px] uppercase tracking-brand text-amber-300">
                orphan — not used by any site / installation / station
              </span>
            )}
          </>
        }
      />

      {/* Header block */}
      <section className="mb-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
          <p className="mb-3 text-[10px] uppercase tracking-brand text-ink-500">
            Tariff identity
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-ink-500">Org</dt>
            <dd className="text-ink-100">{tariff.orgDisplayName}</dd>
            <dt className="text-ink-500">Currency</dt>
            <dd className="font-mono text-ink-200">{tariff.currency}</dd>
            <dt className="text-ink-500">VAT</dt>
            <dd className="font-mono text-ink-200">{tariff.vatRatePct}%</dd>
            <dt className="text-ink-500">Status</dt>
            <dd>
              <StatusBadge status={tariff.status} />
            </dd>
            <dt className="text-ink-500">Valid from</dt>
            <dd className="text-ink-300">{fmtDate(tariff.validFrom)}</dd>
            <dt className="text-ink-500">Valid until</dt>
            <dd className="text-ink-300">{fmtDate(tariff.validUntil)}</dd>
          </dl>
        </div>

        <div className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
          <p className="mb-3 text-[10px] uppercase tracking-brand text-ink-500">
            Compute rule
          </p>
          {tariff.computeRuleKind === "flat" ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-ink-500">Kind</dt>
              <dd className="font-mono text-ink-200">flat</dd>
              <dt className="text-ink-500">Rate</dt>
              <dd className="font-mono text-ink-100">
                {fmtKr(tariff.pricePerKwhMinor)}
              </dd>
            </dl>
          ) : (
            <pre className="overflow-x-auto rounded bg-bg-inset/60 p-3 font-mono text-[10px] text-ink-300">
              {prettyRule(tariff.computeRule)}
            </pre>
          )}
        </div>
      </section>

      {/* Cost factor block */}
      <section className="mb-6 rounded-lg border border-bg-border bg-bg-base/30 p-4">
        <p className="mb-3 text-[10px] uppercase tracking-brand text-ink-500">
          Cost factor
        </p>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div>
            <span className="font-mono text-sv-sky">{tariff.costFactorCode}</span>
            <span className="ml-2 text-ink-300">{tariff.costFactorDisplayName}</span>
          </div>
          <div className="text-ink-500">
            anchor:{" "}
            <span className="font-mono text-ink-300">{tariff.costFactorAnchorTier}</span>
          </div>
          <StatusBadge status={tariff.costFactorStatus} />
          <Link href="/billing/cost-factors" className="text-sv-sky hover:underline">
            View all cost factors →
          </Link>
        </div>
      </section>

      {/* "Used by" sections */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <UsedBySection
          title="Sites (DSO anchor)"
          count={usedBySites.length}
          empty="No sites use this as their DSO tariff."
        >
          {usedBySites.map((s) => (
            <UsedByRow
              key={s.siteId}
              primary={s.displayName}
              secondary={s.orgDisplayName}
              href={`/sites/${s.siteId}`}
            />
          ))}
        </UsedBySection>

        <UsedBySection
          title="Installations (retailer anchor)"
          count={usedByInstallations.length}
          empty="No installations use this as their retailer tariff."
        >
          {usedByInstallations.map((i) => (
            <UsedByRow
              key={i.installationId}
              primary={i.displayName}
              secondary={`${i.siteDisplayName} · ${i.orgDisplayName}`}
              href={`/installations/${i.installationId}`}
            />
          ))}
        </UsedBySection>

        <UsedBySection
          title="Stations (chrgrf anchor)"
          count={usedByStations.length}
          empty="No stations use this as their chargerfee tariff."
        >
          {usedByStations.map((cs) => (
            <UsedByRow
              key={cs.stationId}
              primary={cs.displayName}
              secondary={cs.orgDisplayName}
              href={`/chargers/${cs.stationId}`}
            />
          ))}
        </UsedBySection>
      </div>

      {/* Recent ledger entries */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink-300">
          Recent sessions via this tariff{" "}
          <span className="font-normal text-ink-500">(last 30 days · top 20)</span>
        </h2>
        {recentLedger.length === 0 ? (
          <div className="rounded border border-dashed border-bg-border p-4 text-center text-sm text-ink-500">
            No sessions resolved through this tariff in the last 30 days.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
            <table className="w-full text-xs">
              <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                <tr className="text-left">
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Org</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Charger</th>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2 text-right">kWh</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border/40">
                {recentLedger.map((r) => (
                  <tr key={r.sessionId} className="hover:bg-bg-base/20">
                    <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                      <Link
                        href={`/charge-log/${r.sessionId}` as Parameters<typeof Link>[0]["href"]}
                        className="text-sv-sky hover:underline"
                      >
                        {r.sessionId.slice(0, 8)}…
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-ink-300">
                      {r.orgDisplayName ?? r.orgId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-1.5 text-ink-400">
                      {r.siteDisplayName ?? (r.siteId ? r.siteId.slice(0, 8) : "—")}
                    </td>
                    <td className="px-3 py-1.5 text-ink-400">
                      {r.chargerDisplayName ??
                        (r.chargingStationId ? r.chargingStationId.slice(0, 8) : "—")}
                    </td>
                    <td className="px-3 py-1.5 text-ink-400">
                      {fmtDateTime(r.startedAt)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-ink-200">
                      {Number(r.energyKwh).toFixed(3)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-ink-100">
                      {fmtKr(r.costIskMinor, " kr.")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

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

function UsedBySection({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
      <p className="mb-2 text-[10px] uppercase tracking-brand text-ink-500">
        {title}{" "}
        <span
          className={
            "ml-1 font-semibold " + (count === 0 ? "text-ink-600" : "text-ink-200")
          }
        >
          ({count})
        </span>
      </p>
      {count === 0 ? (
        <p className="text-[11px] text-ink-600">{empty}</p>
      ) : (
        <ul className="space-y-1">{children}</ul>
      )}
    </div>
  );
}

function UsedByRow({
  primary,
  secondary,
  href,
}: {
  primary: string;
  secondary: string;
  href: string;
}) {
  return (
    <li className="text-xs">
      <Link href={href as Parameters<typeof Link>[0]["href"]} className="text-sv-sky hover:underline">
        {primary}
      </Link>
      <span className="ml-1 text-ink-500">· {secondary}</span>
    </li>
  );
}
