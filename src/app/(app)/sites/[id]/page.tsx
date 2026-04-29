import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { apiFetchServer } from "@/lib/api-client-server";
import type { SiteSummary } from "@straumvakt/shared/domain/sites";
import { DeleteButton } from "@/components/delete-button";
import { EditSitePanel } from "./edit-panel";

export const dynamic = "force-dynamic";

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await apiFetchServer(`/api/admin/sites/${id}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { site } = (await res.json()) as { site: SiteSummary };

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

      <section className="mt-8 rounded-lg border border-rose-700/30 bg-rose-950/10 p-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-rose-200">Danger zone</h2>
            <p className="mt-1 text-xs text-rose-300/80">
              Deleting this site cascades through all installations, circuits, chargers,
              EVSEs, connectors, and OcppIdentities anchored under it.
            </p>
          </div>
          <DeleteButton
            endpoint={`/api/admin/sites/${site.id}`}
            redirectTo="/sites"
            confirmText={`Delete site "${site.displayName}" and ALL installations / circuits / chargers under it? This cannot be undone.`}
            label="Delete site"
          />
        </div>
      </section>
    </div>
  );
}
