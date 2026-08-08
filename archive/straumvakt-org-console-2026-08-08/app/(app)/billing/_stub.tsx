// Placeholder for billing-entity pages while the billing model itself
// (cost-factors, tariffs, cost-centers, contracts, driver-contracts) is
// still in flight. The corresponding API Worker endpoints are unported,
// so the page can't pull data; we render a stub instead of crashing the
// build. Replace with the real list page when Phase 5 lands.

import Link from "next/link";
import { SectionTabs, BILLING_TABS } from "@/components/section-tabs";

export function BillingStub({
  title,
  blurb,
}: {
  title: string;
  blurb: string;
}) {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={BILLING_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">{title}</h1>
        <p className="mt-1 text-sm text-ink-400">{blurb}</p>
      </header>
      <div className="rounded border border-amber-700/40 bg-amber-950/20 p-4 text-sm text-amber-200">
        <p className="font-medium">Billing UI is parked.</p>
        <p className="mt-1 text-amber-300/80">
          The billing model is still being defined (cost-factors anchor tiers
          and the parent-inheritance hierarchy are not finalised), so this
          page is intentionally inert. It will return once the entities are
          ported to the API Worker. Other tabs remain live —
          {" "}
          <Link href="/dashboard" className="text-sv-sky hover:underline">
            back to dashboard
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
