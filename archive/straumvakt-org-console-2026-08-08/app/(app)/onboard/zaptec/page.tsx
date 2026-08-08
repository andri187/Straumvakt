import { SectionTabs, ONBOARD_TABS } from "@/components/section-tabs";
import { ZaptecWizardForm } from "./wizard-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zaptec onboarding" };

export default function ZaptecOnboardPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={ONBOARD_TABS} />
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Zaptec onboarding</h1>
        <p className="mt-1 text-sm text-ink-400">
          Connect a Zaptec account and discover the installations its credentials
          grant access to. After review, you map each discovered installation onto
          a Straumvakt Site (Org + Property + Site picked at import time).
        </p>
        <p className="mt-2 rounded border border-amber-700/40 bg-amber-950/20 p-2 text-xs text-amber-200">
          <b>Stub.</b> Real Zaptec OAuth integration lands as part of milestone 2.7.
          The form shows the intended UX. Submit currently surfaces the wiring gap
          without persisting credentials. Use{" "}
          <a className="underline" href="/installations">/installations</a>{" "}
          for manual create until the wizard is wired.
        </p>
      </header>

      <ZaptecWizardForm />
    </div>
  );
}
