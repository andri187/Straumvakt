import Link from "next/link";
import { listOrgs } from "@/lib/repositories/organizations";
import { CreateSiteForm } from "../create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New site" };

export default async function NewSitePage() {
  const orgs = await listOrgs();
  const orgOptions = orgs
    .filter((o) => o.status !== "archived")
    .map((o) => ({ id: o.id, label: `${o.displayName} (${o.slug})` }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/sites" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to sites
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">New site</h1>
        <p className="mt-1 text-sm text-ink-400">
          Required fields are marked with <span className="text-rose-400">*</span>.
        </p>
      </header>
      {orgOptions.length === 0 ? (
        <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">
          Create an Organization + Property first.
        </div>
      ) : (
        <CreateSiteForm orgOptions={orgOptions} />
      )}
    </div>
  );
}
