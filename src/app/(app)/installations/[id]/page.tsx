import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { getInstallationById, listVendors } from "@/lib/repositories/installations";
import { EditInstallationPanel } from "./edit-panel";

export const dynamic = "force-dynamic";

export default async function InstallationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [installation, vendors] = await Promise.all([getInstallationById(id), listVendors()]);
  if (!installation) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <Link href="/installations" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to installations
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">{installation.displayName}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Org <Link href={`/tenants/organizations/${installation.orgId}`} className="text-sv-sky hover:underline">{installation.orgDisplayName}</Link>
          {" · "}Site <span className="text-ink-300">{installation.siteDisplayName}</span>
          {installation.vendorSlug && <> · Vendor <span className="font-mono text-sv-sky">{installation.vendorSlug}</span></>}
        </p>
        <p className="mt-1 font-mono text-[10px] text-ink-500">{installation.id}</p>
      </header>

      <EditInstallationPanel
        installationId={installation.id}
        vendorOptions={vendors}
        initial={{
          displayName: installation.displayName,
          vendorId: vendors.find((v) => v.slug === installation.vendorSlug)?.id ?? "",
          vendorInstallationRef: installation.vendorInstallationRef ?? "",
          onboardingStatus: installation.onboardingStatus,
        }}
      />
    </div>
  );
}
