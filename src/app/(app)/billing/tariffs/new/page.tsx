import Link from "next/link";
import { listOrgs } from "@/lib/repositories/organizations";
import { listCostFactors } from "@/lib/repositories/cost-factors";
import { CreateTariffForm } from "../create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New tariff" };

export default async function NewTariffPage() {
  const [orgs, factors] = await Promise.all([listOrgs(), listCostFactors()]);
  const orgOptions = orgs.filter((o) => o.status !== "archived").map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/billing/tariffs" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to tariffs
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">New tariff</h1>
        <p className="mt-1 text-sm text-ink-400">Required fields are marked with <span className="text-rose-400">*</span>.</p>
      </header>
      {orgOptions.length === 0 || factors.length === 0 ? (
        <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Need at least one Organization and seeded cost factors. Visit{" "}
          <Link href="/billing/cost-factors" className="underline">/billing/cost-factors</Link>.
        </div>
      ) : (
        <CreateTariffForm
          orgOptions={orgOptions}
          factorOptions={factors.map((f) => ({ id: f.id, label: `${f.code} — ${f.displayName}`, vat: f.defaultVatRatePct }))}
        />
      )}
    </div>
  );
}
