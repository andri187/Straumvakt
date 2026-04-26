import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { getOrgById } from "@/lib/repositories/organizations";
import { OrgEditPanel } from "./edit-panel";

export const metadata = { title: "Organization detail" };

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const jar = await cookies();
  const token = jar.get(adminSessionConfig.SESSION_COOKIE_NAME)?.value;
  const session = await verifyAdminSession(token);

  const { id } = await params;
  const org = await getOrgById(id);
  if (!org) notFound();

  return (
    <>
      <Topbar
        title={`Tenants · ${org.displayName}`}
        email={session?.email}
      />
      <PageShell
        title={org.displayName}
        description={`Org ${org.slug} (${org.countryCode}) · status ${org.status}. Created ${new Date(org.createdAt).toLocaleDateString()}.`}
      >
        <div className="mb-3 text-xs text-ink-400">
          <Link href="/tenants/organizations" className="hover:text-ink-50">
            ← All organizations
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            {/* Profile placeholder — fields land in Sprint 2.6 migration per ADR 0010 */}
            <section className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-5 shadow-card backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-brand text-amber-300">
                Profile enrichment landing in Sprint 2.6
              </h2>
              <p className="mt-2 text-sm text-ink-100">
                Per{" "}
                <a
                  href="/docs/adr/0010-organization-profile-enrichment.md"
                  className="text-sv-green hover:text-sv-sky"
                >
                  ADR 0010
                </a>
                , this Org row gains kennitala, vsk_nr, legal_name,
                legal_form, lei_code, default_currency, addresses, contacts,
                branding, regulator_licence_no, and{" "}
                <strong>roles[]</strong> (the 21-value{" "}
                <code className="font-mono text-xs">OrganizationRole</code>{" "}
                enum) as part of the consolidated rev-3 foundation migration.
                The fields below are pre-migration; what you see is the V3
                Sprint-0 minimum. After 2.6, every Org card surfaces full
                identity richness.
              </p>
            </section>

            {/* Asset hierarchy placeholder — Property CRUD lands in Sprint 2.3 */}
            <section className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
              <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
                Asset hierarchy
              </h2>
              <p className="mt-3 text-sm text-ink-200">
                Properties under this Org appear here once Sprint 2.3
                (Property + Site admin CRUD) ships. Per{" "}
                <a
                  href="/docs/adr/0009-drop-charger-host-tier.md"
                  className="text-sv-green hover:text-sv-sky"
                >
                  ADR 0009
                </a>
                , Properties attach directly to Org — the ChargerHost tier
                that previously sat between them was dropped. The HostType
                classifier (workplace / MDU / hotel / fleet / retail) moved
                to <code className="font-mono text-xs">Site.site_type</code>.
              </p>
              <p className="mt-2 text-xs text-ink-400">
                Hierarchy after rev 4: Org → Property → Site → [Installation]
                → [Circuit] → SiteAsset → OCPPIdentity → Connector.
              </p>
            </section>
          </div>

          <aside className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
            <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
              Edit organization
            </h2>
            <p className="mt-2 text-xs text-ink-400">
              Slug is immutable (used in URLs). Display name + country can
              change. Archive removes from the default list view but
              preserves all rows. Profile-enrichment fields editable after
              Sprint 2.6 migration.
            </p>
            <div className="mt-4">
              <OrgEditPanel
                orgId={org.id}
                initial={{
                  displayName: org.displayName,
                  countryCode: org.countryCode,
                  status: org.status,
                }}
              />
            </div>
          </aside>
        </div>
      </PageShell>
    </>
  );
}
