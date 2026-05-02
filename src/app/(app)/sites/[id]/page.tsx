import Link from "next/link";
import { notFound } from "next/navigation";
import { SectionTabs, OPERATIONS_TABS } from "@/components/section-tabs";
import { apiFetchServer } from "@/lib/api-client-server";
import type { SiteSummary } from "@straumvakt/shared/domain/sites";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";
import { DeleteButton } from "@/components/delete-button";
import { EditSitePanel } from "./edit-panel";
import { MoveSiteButton } from "./move-site-button";

export const dynamic = "force-dynamic";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// Project the freeform openingHours JSONB into the form's typed shape
// (single window per day + closed flag). The API zod accepts up to 6
// windows per day; if the row was hand-edited to multi-window the form
// will pick the first window only — we don't drop the rest, the
// backend only sees the new patch when the operator clicks Save.
function hydrateOpeningHours(
  raw: unknown,
): Record<(typeof DAYS)[number], { closed: boolean; open: string; close: string }> {
  const out = {} as Record<(typeof DAYS)[number], { closed: boolean; open: string; close: string }>;
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const d of DAYS) {
    const v = obj[d];
    if (Array.isArray(v) && v.length > 0) {
      const w = v[0] as { open?: unknown; close?: unknown };
      out[d] = {
        closed: false,
        open: typeof w.open === "string" ? w.open : "08:00",
        close: typeof w.close === "string" ? w.close : "18:00",
      };
    } else {
      // empty array OR missing key → closed.
      out[d] = { closed: true, open: "08:00", close: "18:00" };
    }
  }
  return out;
}

function extractNotes(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const v = (raw as Record<string, unknown>).notes;
  return typeof v === "string" ? v : "";
}

export default async function SiteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [siteRes, orgsRes] = await Promise.all([
    apiFetchServer(`/api/admin/sites/${id}`),
    apiFetchServer(`/api/admin/orgs?includeArchived=false`),
  ]);
  if (siteRes.status === 404) notFound();
  if (!siteRes.ok) throw new Error(`HTTP ${siteRes.status}`);
  const { site } = (await siteRes.json()) as { site: SiteSummary };
  const { orgs } = orgsRes.ok
    ? ((await orgsRes.json()) as { orgs: OrgSummary[] })
    : { orgs: [] };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <SectionTabs tabs={OPERATIONS_TABS} />
      <Link href="/sites" className="mb-4 inline-block text-xs text-ink-400 hover:text-sv-sky">
        ← Back to sites
      </Link>
      <header className="mb-6 border-b border-bg-border pb-4">
        <h1 className="text-2xl font-semibold text-ink-50">{site.displayName}</h1>
        <p className="mt-1 text-sm text-ink-400">
          Site under <Link href={`/accounts/organizations/${site.orgId}` as Parameters<typeof Link>[0]["href"]} className="text-sv-sky hover:underline">{site.orgDisplayName}</Link>
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
          openingHours: hydrateOpeningHours(site.openingHours),
          openingNotes: extractNotes(site.openingHours),
          accessNote: site.accessNote ?? "",
          photoUrl: site.photoUrl ?? "",
        }}
      />

      <section className="mt-8 space-y-4 rounded-lg border border-amber-700/30 bg-amber-950/10 p-4">
        <div>
          <h2 className="text-sm font-semibold text-amber-200">Manage site</h2>
          <p className="mt-1 text-xs text-amber-300/80">
            Move this site (and everything under it — installations, circuits,
            chargers, sessions, history) to a different organization. The
            cascade runs in one transaction. Tariff anchors and vendor-credential
            links are cleared and need to be re-set in the new org.
          </p>
        </div>
        <MoveSiteButton
          siteId={site.id}
          siteDisplayName={site.displayName}
          currentOrgId={site.orgId}
          currentOrgDisplayName={site.orgDisplayName}
          orgs={orgs}
        />
      </section>

      <section className="mt-4 rounded-lg border border-rose-700/30 bg-rose-950/10 p-4">
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
