import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetchServerJson } from "@/lib/api-client-server";
import { EditCostFactorForm } from "./edit-cost-factor-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Edit cost factor" };

interface CostFactorRow {
  id: string;
  code: string;
  displayName: string;
  description: string | null;
  anchorTier: string;
  defaultVatRatePct: string;
  defaultCurrency: string;
  status: string;
  tariffCount: number;
  isOrphan: boolean;
}

interface CostFactorCatalogueSummary {
  totalFactors: number;
  orphanCount: number;
  byAnchor: { anchor: string; factors: CostFactorRow[] }[];
}

export default async function EditCostFactorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Load the full catalogue and find the row by id.
  // (No single-factor GET endpoint yet — reading from the catalogue list.)
  const summary = await apiFetchServerJson<CostFactorCatalogueSummary>(
    "/api/admin/billing/cost-factors",
  );

  const factor = summary.byAnchor
    .flatMap((g) => g.factors)
    .find((f) => f.id === id);

  if (!factor) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href="/billing/cost-factors"
        className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky"
      >
        ← Back to cost factor catalogue
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold text-ink-50">
            Edit cost factor
          </h1>
          <span className="font-mono text-sm text-sv-sky">{factor.code}</span>
        </div>
        <p className="mt-1 text-sm text-ink-400">
          <span className="font-mono text-ink-300">code</span> and{" "}
          <span className="font-mono text-ink-300">anchorTier</span> are shown
          for reference but cannot be changed. To change either, create a new
          factor row.
        </p>
      </header>
      <EditCostFactorForm factor={factor} />
    </div>
  );
}
