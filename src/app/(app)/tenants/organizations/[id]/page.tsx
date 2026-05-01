import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/topbar";
import { PageShell } from "@/components/page-shell";
import { adminSessionConfig, verifyAdminSession } from "@/lib/admin-session";
import { apiFetchServer } from "@/lib/api-client-server";
import type { OrgSummary } from "@straumvakt/shared/domain/orgs";
import type { OrgMembershipSummary } from "@straumvakt/shared/domain/users";
import { OrgEditPanel, type MemberOption } from "./edit-panel";

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
  const [orgRes, memRes] = await Promise.all([
    apiFetchServer(`/api/admin/orgs/${id}`),
    apiFetchServer(`/api/admin/orgs/${id}/memberships`),
  ]);
  if (orgRes.status === 404) notFound();
  if (!orgRes.ok) throw new Error(`HTTP ${orgRes.status}`);
  const { org } = (await orgRes.json()) as { org: OrgSummary };
  const { memberships } = memRes.ok
    ? ((await memRes.json()) as { memberships: OrgMembershipSummary[] })
    : { memberships: [] };

  // Picker for the main contact only surfaces users with an active
  // Membership in this org — keeps the contact tied to someone with
  // access. Soft enforcement: if the picked user is later removed
  // from the org, the FK stays valid (DB SET NULL on user delete only
  // — Membership delete doesn't cascade). Operator handles that case
  // manually.
  const memberOptions: MemberOption[] = memberships.map((m) => ({
    userId: m.userId,
    displayName: m.userDisplayName,
    email: m.userEmail,
  }));

  const headline = [
    org.kennitala ? `kennitala ${formatKennitala(org.kennitala)}` : null,
    org.legalForm,
    org.countryCode,
    `status ${org.status}`,
    `created ${new Date(org.createdAt).toLocaleDateString()}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Topbar
        title={`Tenants · ${org.displayName}`}
        email={session?.email}
      />
      <PageShell title={org.displayName} description={headline}>
        <div className="mb-3 text-xs text-ink-400">
          <Link href="/tenants/organizations" className="hover:text-ink-50">
            ← All organizations
          </Link>
        </div>

        {/* Read-only profile summary surfaces the most operationally
            useful fields without unfolding the edit panel — kennitala,
            legal name + form, addresses, main contact. */}
        <div className="mb-4 rounded-lg border border-bg-border bg-bg-base/30 p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-brand text-ink-300">
            Profile
          </h2>
          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Row label="Kennitala" value={org.kennitala ? formatKennitala(org.kennitala) : null} mono />
            <Row label="VSK" value={org.vskNr} mono />
            <Row label="Legal name (heiti)" value={org.legalName} />
            <Row label="Legal form" value={[org.legalForm, org.legalFormCode ? `[${org.legalFormCode}]` : null].filter(Boolean).join(" ") || null} />
            <Row label="Currency" value={org.defaultCurrency} mono />
            <Row label="LEI" value={org.leiCode} mono />
            <AddressRow label="Póstfang" address={org.postalAddress} />
            <AddressRow label="Lögheimili" address={org.legalAddress} />
            <Row
              label="Sveitarfélag"
              value={[org.municipalityCode, org.municipalityName].filter(Boolean).join(" ") || null}
            />
            <Row
              label="Roles"
              value={
                org.roles.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {org.roles.map((r) => (
                      <span key={r} className="rounded bg-sv-sky/10 px-1.5 py-0.5 font-mono text-[10px] text-sv-sky">
                        {r}
                      </span>
                    ))}
                  </span>
                ) : null
              }
            />
            <Row
              label="Main contact"
              value={
                org.mainContact
                  ? `${org.mainContact.displayName ?? org.mainContact.email}${org.mainContact.displayName ? ` · ${org.mainContact.email}` : ""}`
                  : null
              }
            />
          </div>
        </div>

        <div className="rounded-lg border border-bg-border bg-bg-surface/70 p-5 shadow-card backdrop-blur">
          <h2 className="text-xs font-semibold uppercase tracking-brand text-sv-sky">
            Edit organization
          </h2>
          <p className="mt-2 text-xs text-ink-400">
            Kennitala identifies the org once set. Main contact picker only
            surfaces users with an active Membership in this org. Archive
            removes from the default list view but preserves all rows.
          </p>
          <div className="mt-4">
            <OrgEditPanel
              orgId={org.id}
              members={memberOptions}
              initial={{
                displayName: org.displayName,
                countryCode: org.countryCode,
                status: org.status,
                kennitala: org.kennitala,
                legalName: org.legalName,
                legalForm: org.legalForm,
                legalFormCode: org.legalFormCode,
                vskNr: org.vskNr,
                leiCode: org.leiCode,
                defaultCurrency: org.defaultCurrency,
                regulatorLicenceNo: org.regulatorLicenceNo,
                notes: org.notes,
                roles: org.roles,
                postalAddress: org.postalAddress,
                legalAddress: org.legalAddress,
                municipalityCode: org.municipalityCode,
                municipalityName: org.municipalityName,
                branding: (org.branding ?? {}) as { logoUrl?: string; primaryColor?: string; secondaryColor?: string },
                mainContactUserId: org.mainContactUserId,
                mainContact: org.mainContact,
              }}
            />
          </div>
        </div>
      </PageShell>
    </>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | React.ReactNode | null;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="shrink-0 basis-32 text-[10px] uppercase tracking-brand text-ink-500">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-ink-200" : "text-ink-200"}>
        {value ?? <span className="text-ink-500">—</span>}
      </dd>
    </div>
  );
}

function AddressRow({
  label,
  address,
}: {
  label: string;
  address: { street: string; postalCode: string; city: string } | null;
}) {
  return (
    <Row
      label={label}
      value={
        address
          ? `${address.street}, ${address.postalCode} ${address.city}`
          : null
      }
    />
  );
}

// Display-only kennitala formatting: 1234567890 → 123456-7890.
function formatKennitala(raw: string): string {
  const digits = raw.replace(/-/g, "");
  return digits.length === 10 ? `${digits.slice(0, 6)}-${digits.slice(6)}` : raw;
}
