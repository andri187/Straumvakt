import { BillingStub } from "../_stub";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Tariffs" };

export default function TariffsPage() {
  return <BillingStub title="Tariffs" blurb="Per-org tariffs anchored on cost-factors." />;
}
