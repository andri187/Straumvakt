import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { getSiteById } from "@/lib/repositories/sites";
import { EditSitePanel } from "./edit-panel";

export const dynamic = "force-dynamic";

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await getSiteById(id);
  if (!site) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <Link href="/sites" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to sites
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">{site.displayName}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Site under <Link href={`/tenants/organizations/${site.orgId}`} className="text-sv-sky hover:underline">{site.orgDisplayName}</Link>
          {" · "}Property <span className="text-ink-300">{site.propertyDisplayName}</span>
        </p>
        <p className="mt-1 font-mono text-[10px] text-ink-500">{site.id}</p>
      </header>

      <EditSitePanel
        siteId={site.id}
        initial={{
          displayName: site.displayName,
          timezone: site.timezone,
          siteType: site.siteType,
          accessLevel: site.accessLevel,
          powerClass: site.powerClass ?? "",
          provisioningStatus: site.provisioningStatus,
          dsoTariffId: site.dsoTariffId ?? "",
          usrfTariffId: site.usrfTariffId ?? "",
          usrfPremTariffId: site.usrfPremTariffId ?? "",
          xtrrfTariffId: site.xtrrfTariffId ?? "",
          spvivfTariffId: site.spvivfTariffId ?? "",
        }}
      />
    </div>
  );
}
