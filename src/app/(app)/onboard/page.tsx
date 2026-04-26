import { SectionTabs, ONBOARD_TABS } from "@/components/section-tabs";
import { OnboardForm } from "./onboard-form";

export const metadata = {
  title: "Onboard test chain",
};

export default function OnboardPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={ONBOARD_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">
          Onboard test chain
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Stands up a complete entity tree in one transaction:
          Organization → Property → Site → ChargingStation → EVSE →
          Connector + OcppIdentity. Use this until the per-tier CRUD pages
          land in Sprint 2. Required fields are marked with{" "}
          <span className="text-rose-400">*</span>; optional fields can be
          left blank.
        </p>
      </header>
      <OnboardForm />
    </div>
  );
}
