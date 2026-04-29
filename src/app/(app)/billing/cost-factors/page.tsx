import { BillingStub } from "../_stub";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing · Cost factors" };

export default function CostFactorsPage() {
  return (
    <BillingStub
      title="Cost factors"
      blurb="Anchor tiers and platform-defined cost factors."
    />
  );
}
