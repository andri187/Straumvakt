import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { apiFetchServer, apiFetchServerJson } from "@/lib/api-client-server";
import type { InstallationSummary } from "@straumvakt/shared/domain/installations";
import { EditInstallationPanel } from "./edit-panel";

export const dynamic = "force-dynamic";

export default async function InstallationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detailRes = await apiFetchServer(`/api/admin/installations/${id}`);
  if (detailRes.status === 404) notFound();
  if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
  const { installation } = (await detailRes.json()) as { installation: InstallationSummary };
  // GET /installations returns the vendors list alongside; reuse it here.
  const { vendors } = await apiFetchServerJson<{
    vendors: { id: string; slug: string; displayName: string }[];
  }>("/api/admin/installations");

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
          vendorId: installation.vendorId ?? "",
          modelId: installation.modelId ?? "",
          vendorInstallationRef: installation.vendorInstallationRef ?? "",
          credentialsRef: installation.credentialsRef ?? "",
          credentialsStatus: installation.credentialsStatus ?? "",
          onboardingStatus: installation.onboardingStatus,
          retailerTariffId: installation.retailerTariffId ?? "",
        }}
      />
    </div>
  );
}
