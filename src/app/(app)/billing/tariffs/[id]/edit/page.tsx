// /billing/tariffs/[id]/edit — Edit a TariffDefinition.
// Sprint 9 — Track C.
//
// Server Component: fetches tariff detail + cost factor list.
// Client Component: EditTariffForm handles form state and PATCH to API.
//
// Status-gating:
//   - draft: all fields editable
//   - active: only display_name editable (Rule 5)
//   - retired: redirect to detail page (no edits allowed)

import Link from "next/link";
import { redirect } from "next/navigation";
import {
  SectionTabs,
  OPERATIONS_TABS,
  BILLING_TABS,
} from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import { EditTariffForm } from "./edit-form";

export const dynamic = "force-dynamic";

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
}

interface TariffDetailResponse {
  tariff: TariffDetailHeader | null;
  usedBySites: unknown[];
  usedByInstallations: unknown[];
  usedByStations: unknown[];
}

interface CostFactorRow {
  id: string;
  code: string;
  displayName: string;
  defaultVatRatePct: string;
}

interface CostFactorsResponse {
  totalFactors: number;
  byAnchor: {
    anchor: string;
    factors: CostFactorRow[];
  }[];
}

export default async function EditTariffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [detailData, factorsData] = await Promise.all([
    apiFetchServerJson<TariffDetailResponse>(
      `/api/admin/billing/tariffs/${id}/detail`,
    ),
    apiFetchServerJson<CostFactorsResponse>("/api/admin/billing/cost-factors"),
  ]);

  if (!detailData.tariff) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
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

  const tariff = detailData.tariff;

  // Retired tariffs cannot be edited — redirect to detail.
  if (tariff.status === "retired") {
    redirect(`/billing/tariffs/${id}`);
  }

  const factorOptions = factorsData.byAnchor.flatMap((group) =>
    group.factors.map((f) => ({
      id: f.id,
      label: `${f.code} — ${f.displayName}`,
      vat: f.defaultVatRatePct,
    })),
  );

  const isActiveOnly = tariff.status === "active";

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />

      <ActionBar
        title={`Edit: ${tariff.displayName}`}
        description={
          <>
            <Link
              href={`/billing/tariffs/${id}`}
              className="text-sv-sky hover:underline"
            >
              ← Back to tariff detail
            </Link>
            {isActiveOnly && (
              <span className="ml-3 rounded border border-amber-700/40 bg-amber-950/30 px-2 py-0.5 text-[10px] uppercase tracking-brand text-amber-300">
                active — only display name editable
              </span>
            )}
          </>
        }
      />

      {isActiveOnly && (
        <div className="mb-4 rounded border border-amber-700/30 bg-amber-950/20 p-3 text-xs text-amber-200">
          This tariff is <strong>active</strong> and is currently used for
          session-stop cost resolution. Resolution fields (compute rule,
          currency, VAT rate, cost factor) are immutable.{" "}
          <Link
            href={`/billing/tariffs/${id}`}
            className="text-amber-300 hover:underline"
          >
            Clone this tariff
          </Link>{" "}
          to create an editable draft with the same settings.
        </div>
      )}

      <div className="rounded-lg border border-bg-border bg-bg-base/30 p-6">
        <EditTariffForm
          tariff={tariff}
          factorOptions={factorOptions}
          isActiveOnly={isActiveOnly}
        />
      </div>
    </div>
  );
}
