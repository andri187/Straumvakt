import Link from "next/link";
import { NewCostFactorForm } from "./new-cost-factor-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · New cost factor" };

export default function NewCostFactorPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link
        href="/billing/cost-factors"
        className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky"
      >
        ← Back to cost factor catalogue
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">New cost factor</h1>
        <p className="mt-1 text-sm text-ink-400">
          Cost factors are platform-defined billing primitives anchored at a
          level of the asset hierarchy. The <span className="font-mono text-sv-sky">code</span> and{" "}
          <span className="font-mono text-sv-sky">anchorTier</span> are immutable once set — if
          either needs to change, create a new factor row and re-wire the references.
        </p>
      </header>
      <NewCostFactorForm />
    </div>
  );
}
