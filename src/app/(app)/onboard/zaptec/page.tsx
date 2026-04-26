import { ZaptecWizardForm } from "./wizard-form";
import { listOrgs } from "@/lib/repositories/organizations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Zaptec onboarding" };

export default async function ZaptecOnboardPage() {
  const orgs = await listOrgs();
  const orgOptions = orgs.filter((o) => o.status !== "archived").map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-ink-50">Zaptec onboarding</h1>
        <p className="mt-1 text-sm text-ink-400">
          Auto-discovers Zaptec installations + circuits + chargers via the
          Zaptec OAuth API and creates the matching Straumvakt rows in one
          transaction. Replaces manual Installation → Circuit → Charger
          entry for Zaptec deployments.
        </p>
        <p className="mt-2 rounded border border-amber-700/40 bg-amber-950/20 p-2 text-xs text-amber-200">
          <b>Stub.</b> Real OAuth integration lands as part of milestone 2.7.
          The form below shows the intended UX. Submit currently returns a
          501 with the credentials never leaving the browser. Use{" "}
          <a className="underline" href="/installations">/installations</a>{" "}
          for manual create until the wizard is wired.
        </p>
      </header>

      {orgOptions.length === 0 ? (
        <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Create an Organization + Property + Site first.
        </div>
      ) : (
        <ZaptecWizardForm orgOptions={orgOptions} />
      )}
    </div>
  );
}
