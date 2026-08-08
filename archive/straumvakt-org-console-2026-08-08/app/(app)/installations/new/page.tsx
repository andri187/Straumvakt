import Link from "next/link";
import { apiFetchServerJson } from "@/lib/api-client-server";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";
import { CreateInstallationForm } from "../create-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New installation" };

type Vendor = { id: string; slug: string; displayName: string };

export default async function NewInstallationPage() {
  const [{ orgs }, { vendors }] = await Promise.all([
    apiFetchServerJson<{ orgs: OrgSummary[] }>("/api/admin/orgs"),
    apiFetchServerJson<{ vendors: Vendor[] }>("/api/admin/installations"),
  ]);
  const orgOptions = orgs
    .filter((o) => o.status !== "archived")
    .map((o) => ({ id: o.id, label: o.kennitala ? `${o.displayName} · ${o.kennitala}` : o.displayName }));

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link href="/installations" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to installations
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">New installation</h1>
        <p className="mt-1 text-sm text-ink-400">Required fields are marked with <span className="text-rose-400">*</span>.</p>
      </header>
      {orgOptions.length === 0 ? (
        <div className="rounded border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-200">Create an Organization, Property, and Site first.</div>
      ) : (
        <CreateInstallationForm orgOptions={orgOptions} vendorOptions={vendors} />
      )}
    </div>
  );
}
