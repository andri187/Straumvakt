import Link from "next/link";
import { CreateOrgForm } from "../create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New organization" };

export default function NewOrganizationPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/accounts/organizations" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to organizations
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">New organization</h1>
        <p className="mt-1 text-sm text-ink-400">
          Required fields are marked with <span className="text-rose-400">*</span>.
          Slug becomes the URL key (lowercase, dashes only). Country is
          ISO-3166-1 alpha-2.
        </p>
      </header>
      <CreateOrgForm />
    </div>
  );
}
