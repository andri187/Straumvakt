// /billing/tariffs/new — Create a new draft TariffDefinition.
// Sprint 9 — Track C.
//
// Server Component: fetches org list + cost factor list to populate the form.
// Client Component: CreateTariffForm handles form state and POST to API.

import {
  SectionTabs,
  OPERATIONS_TABS,
  BILLING_TABS,
} from "@/components/section-tabs";
import { ActionBar } from "@/components/action-bar";
import { apiFetchServerJson } from "@/lib/api-client-server";
import { CreateTariffForm } from "../create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · New tariff" };

interface OrgRow {
  id: string;
  displayName: string;
}

interface CostFactorRow {
  id: string;
  code: string;
  displayName: string;
  defaultVatRatePct: string;
}

interface OrgsResponse {
  orgs: OrgRow[];
}

interface CostFactorsResponse {
  totalFactors: number;
  byAnchor: {
    anchor: string;
    factors: CostFactorRow[];
  }[];
}

export default async function NewTariffPage() {
  const [orgsData, factorsData] = await Promise.all([
    apiFetchServerJson<OrgsResponse>("/api/admin/orgs"),
    apiFetchServerJson<CostFactorsResponse>("/api/admin/billing/cost-factors"),
  ]);

  const orgOptions = orgsData.orgs.map((o) => ({
    id: o.id,
    label: o.displayName,
  }));

  const factorOptions = factorsData.byAnchor.flatMap((group) =>
    group.factors.map((f) => ({
      id: f.id,
      label: `${f.code} — ${f.displayName}`,
      vat: f.defaultVatRatePct,
      anchor: group.anchor,
    })),
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <SectionTabs tabs={BILLING_TABS} />
      <ActionBar
        title="New tariff"
        description="Create a draft TariffDefinition. Drafts are not resolved until published."
      />
      <div className="rounded-lg border border-bg-border bg-bg-base/30 p-6">
        <CreateTariffForm
          orgOptions={orgOptions}
          factorOptions={factorOptions}
        />
      </div>
    </div>
  );
}
