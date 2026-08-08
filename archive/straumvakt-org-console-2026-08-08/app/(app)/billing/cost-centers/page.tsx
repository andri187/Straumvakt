// Cost centers catalogue — Sprint 9 Track D.
// Replaces the BillingStub placeholder.
//
// Cost center decision: a "cost center" in Straumvakt maps directly to the
// billing.cost_centers table (model CostCenter). This is NOT a filtered view
// of tenancy.organizations — it is an explicit allocation entity that routes
// billed amounts to a specific payer org or payer user, with an optional
// beneficiary org. Each cost center belongs to an owning org (orgId) and can
// point to a different payerOrg or payerUser for splitting bills across
// B2B counterparties (e.g. a workplace paying for employee home charging).

import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Cost centers" };

// ── Types ─────────────────────────────────────────────────────────────────────

interface CostCenterRow {
  id: string;
  orgId: string;
  orgDisplayName: string;
  code: string;
  displayName: string;
  payerOrgId: string | null;
  payerOrgDisplayName: string | null;
  payerUserId: string | null;
  payerUserDisplayName: string | null;
  beneficiaryOrgId: string | null;
  beneficiaryOrgDisplayName: string | null;
  status: string;
  activeMembershipCount: number;
  lastSessionDate: string | null;
  currentPeriodCostIskMinor: string;
  anchoredTariffCount: number;
  createdAt: string;
}

interface CostCentersResponse {
  costCenters: CostCenterRow[];
  period: { year: number; month: number };
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtKr(minorStr: string): string {
  if (!minorStr || minorStr === "0") return "—";
  try {
    const minor = BigInt(minorStr);
    if (minor === 0n) return "—";
    const whole = minor / 100n;
    const aurar = minor % 100n;
    const aurarStr = aurar < 10n ? `0${aurar}` : `${aurar}`;
    const wholeStr = whole
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${wholeStr},${aurarStr} kr.`;
  } catch {
    return "—";
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  } catch {
    return iso;
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function CostCentersPage() {
  let data: CostCentersResponse | null = null;
  let fetchError: string | null = null;

  try {
    data = await apiFetchServerJson<CostCentersResponse>(
      "/api/admin/billing/cost-centers",
    );
  } catch (err) {
    fetchError = err instanceof Error ? err.message : String(err);
  }

  const rows = data?.costCenters ?? [];
  const period = data?.period ?? {
    year: new Date().getUTCFullYear(),
    month: new Date().getUTCMonth() + 1,
  };
  const monthLabel = MONTH_NAMES[(period.month - 1) % 12];

  // Group by owning org for readability
  const byOrg = new Map<string, CostCenterRow[]>();
  for (const cc of rows) {
    const arr = byOrg.get(cc.orgDisplayName) ?? [];
    arr.push(cc);
    byOrg.set(cc.orgDisplayName, arr);
  }
  const orgs = Array.from(byOrg.keys()).sort();

  const activeCount = rows.filter((cc) => cc.status === "active").length;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="Cost centers"
        description="Payer/beneficiary routing for billed sessions. Each cost center allocates amounts to a specific payer org or user, optionally with a beneficiary org. Managed via billing.cost_centers (ADR 0008)."
      />

      {fetchError && (
        <div className="mb-4 rounded border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-200">
          Could not load cost centers: {fetchError}
        </div>
      )}

      <div className="mb-6 grid grid-cols-3 gap-3">
        <Tile label="Total cost centers" value={String(rows.length)} />
        <Tile label="Active" value={String(activeCount)} />
        <Tile label="Organisations" value={String(orgs.length)} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-dashed border-bg-border p-6 text-center text-sm text-ink-500">
          No cost centers defined yet. Create via seed scripts or the cost-center API.
        </div>
      ) : (
        orgs.map((org) => {
          const orgRows = byOrg.get(org) ?? [];
          return (
            <section key={org} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-brand text-ink-300">
                {org} ({orgRows.length})
              </h2>
              <div className="overflow-hidden rounded-md border border-bg-border bg-bg-base/30">
                <table className="w-full text-xs">
                  <thead className="bg-bg-inset/40 text-[10px] uppercase tracking-brand text-ink-500">
                    <tr className="text-left">
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Code</th>
                      <th className="px-3 py-2">Payer</th>
                      <th className="px-3 py-2">Beneficiary</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2 text-right">Members</th>
                      <th className="px-3 py-2 text-right">Tariffs</th>
                      <th className="px-3 py-2 text-right">Last session</th>
                      <th className="px-3 py-2 text-right">
                        {monthLabel} revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-border/40">
                    {orgRows.map((cc) => (
                      <tr key={cc.id} className="hover:bg-bg-base/20">
                        <td className="px-3 py-1.5 text-ink-100">
                          {cc.displayName}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-ink-400">
                          {cc.code}
                        </td>
                        <td className="px-3 py-1.5 text-ink-300">
                          {cc.payerOrgDisplayName ??
                            cc.payerUserDisplayName ??
                            "—"}
                          {cc.payerOrgDisplayName && (
                            <span className="ml-1 rounded border border-sv-sky/20 bg-sv-sky/10 px-1 py-0.5 text-[9px] uppercase tracking-brand text-sv-sky">
                              org
                            </span>
                          )}
                          {cc.payerUserId && !cc.payerOrgId && (
                            <span className="ml-1 rounded border border-ink-600/30 bg-ink-600/10 px-1 py-0.5 text-[9px] uppercase tracking-brand text-ink-400">
                              user
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-ink-400">
                          {cc.beneficiaryOrgDisplayName ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">
                          <StatusBadge status={cc.status} />
                        </td>
                        <td className="px-3 py-1.5 text-right text-ink-300">
                          {cc.activeMembershipCount}
                        </td>
                        <td className="px-3 py-1.5 text-right text-ink-300">
                          {cc.anchoredTariffCount}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-[10px] text-ink-400">
                          {fmtDate(cc.lastSessionDate)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-ink-200">
                          {fmtKr(cc.currentPeriodCostIskMinor)}
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

      <p className="mt-4 text-[10px] text-ink-600">
        Revenue figures use billing.billing_lines (inc. VAT) for the current calendar
        month (UTC). Member counts are active memberships of the owning org.
        Tariff count is active TariffDefinitions for the owning org.
      </p>
    </div>
  );
}

// ── Shared UI components ──────────────────────────────────────────────────────

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-base/30 p-4">
      <p className="text-[10px] uppercase tracking-brand text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink-50">{value}</p>
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
