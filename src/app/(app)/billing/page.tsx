import { BillingStub } from "./_stub";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

export default function BillingPage() {
  return (
    <BillingStub
      title="Billing"
      blurb="Combined view across cost-factors, tariffs, cost-centers, contracts, and driver-contracts."
    />
  );
}
