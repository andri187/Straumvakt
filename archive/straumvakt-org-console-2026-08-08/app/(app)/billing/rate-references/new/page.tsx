// Stage new rate-reference version — Sprint 9 (Phase 1 Track B).
//
// This is the ONLY way to introduce a new rate. "Edit" on an active row is
// blocked by the API (ADR 0019 Rule 5 — active rows are immutable for
// resolution fields). This form stages a future-effective version.
//
// Query params (for pre-fill from the catalogue page):
//   ?code=<stable-code>           pre-fills the code field
//   ?costFactorId=<uuid>          pre-selects the cost factor

import { apiFetchServerJson } from "@/lib/api-client-server";
import { SectionTabs, OPERATIONS_TABS, BILLING_TABS } from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import Link from "next/link";
import { StageNewVersionForm } from "./stage-form";

interface CostFactorOption {
  id: string;
  code: string;
  displayNameEn: string;
}

interface AgreementCostFactorsResponse {
  costFactors: CostFactorOption[];
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Stage rate version" };

export default async function StageNewRateReferencePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; costFactorId?: string }>;
}) {
  const { code: prefillCode, costFactorId: prefillCostFactorId } =
    await searchParams;

  // Load available cost factors from the agreements.cost_factors catalog.
  const { costFactors } = await apiFetchServerJson<AgreementCostFactorsResponse>(
    "/api/admin/billing/rate-references/cost-factors",
  ).catch(() => ({ costFactors: [] as CostFactorOption[] }));

  // Fallback: if the cost-factors sub-endpoint is not yet available, use
  // an empty list and let the operator type the UUID. This won't happen
  // in production where the catalog is seeded.
  const factorOptions = costFactors.map((f) => ({
    id: f.id,
    label: `${f.code} — ${f.displayNameEn}`,
  }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />

      <Link
        href={"/billing/rate-references" as Parameters<typeof Link>[0]["href"]}
        className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky"
      >
        ← Back to rate book
      </Link>

      <ActionBar
        title="Stage new rate version"
        description="Creates a new rate row for a code. If an active row exists for the same code, its effective_until is automatically set to this version's effective_from (single transaction). Resolution fields are immutable once active — see ADR 0019."
      />

      <div className="rounded-lg border border-bg-border bg-bg-base/30 p-6">
        <StageNewVersionForm
          factorOptions={factorOptions}
          prefillCode={prefillCode ?? ""}
          prefillCostFactorId={prefillCostFactorId ?? ""}
        />
      </div>

      <div className="mt-4 rounded border border-amber-700/30 bg-amber-950/10 px-4 py-3 text-xs text-amber-300">
        <strong>Rule 5 — active rows are immutable.</strong> Once a row&apos;s
        effective window begins, its price, basis, and dates cannot be changed.
        Stage a replacement version with a future <code>effective_from</code> to
        update the rate. The previous row&apos;s window is closed automatically.
      </div>
    </div>
  );
}
