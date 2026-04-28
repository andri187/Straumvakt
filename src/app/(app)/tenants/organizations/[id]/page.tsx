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

        <div className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
          <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
            Edit organization
          </h2>
          <p className="mt-2 text-xs text-ink-400">
            Slug is immutable (used in URLs). Every other field is editable.
            Archive removes from the default list view but preserves all rows.
          </p>
          <div className="mt-4">
            <OrgEditPanel
              orgId={org.id}
              initial={{
                displayName: org.displayName,
                countryCode: org.countryCode,
                status: org.status,
                kennitala: org.kennitala,
                legalName: org.legalName,
                legalForm: org.legalForm,
                vskNr: org.vskNr,
                leiCode: org.leiCode,
                defaultCurrency: org.defaultCurrency,
                regulatorLicenceNo: org.regulatorLicenceNo,
                notes: org.notes,
                roles: org.roles,
                addresses: (org.addresses ?? {}) as { primary?: { street?: string; city?: string; postal_code?: string; country?: string } },
                contacts: (org.contacts ?? {}) as { primary?: { name?: string; email?: string; phone?: string } },
              }}
            />
          </div>
        </div>
      </PageShell>
    </>
  );
}
